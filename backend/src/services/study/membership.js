// Att sluta ha ett område man följer (sharedWith, från före kopiorna) — med
// städning. Delas av delningen (services/study/sharing.js: ta bort, lämna,
// ovänner, blockeringar) och kopiorna (services/study/copies.js: den som byter
// från att följa ett original till en egen kopia), så ingen glömmer något steg.
const StudyUnit = require('../../models/StudyUnit');
const StudyFolder = require('../../models/StudyFolder');
const StudyFlag = require('../../models/StudyFlag');
const StudyShareLink = require('../../models/StudyShareLink');
const { oid } = require('./access');

/** Områdena en länk gäller: `units` på en länk till flera, annars `unit`. */
function linkUnitIds(link) {
  return link.units && link.units.length ? link.units : [link.unit];
}

/**
 * Ta bort områdena `dropIds` ur en länk; gäller den inget område efter det
 * stängs den. Varje steg är en egen atomär uppdatering, så två som trimmar
 * samma länk samtidigt aldrig skriver tillbaka ett område den andra tog bort.
 */
async function trimLink(link, dropIds) {
  const drop = dropIds.map(oid);
  // 1. Ur listan över områden (en länk till ett område har ingen lista).
  await StudyShareLink.updateOne({ _id: link._id }, { $pull: { units: { $in: drop } } });
  // 2. Var det första området (`unit`) som togs bort: flytta det till det som nu står först.
  await StudyShareLink.updateOne(
    { _id: link._id, unit: { $in: drop }, 'units.0': { $exists: true } },
    [{ $set: { unit: { $arrayElemAt: ['$units', 0] } } }]
  );
  // 3. Gäller länken inget område längre: stäng den.
  await StudyShareLink.updateOne(
    { _id: link._id, unit: { $in: drop }, 'units.0': { $exists: false }, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

/**
 * Ta bort `recipient` ur områdena `ids`: ur delningen, ur hens mappar och
 * öppna felrapporter, och ur länkar hen gjort till dem (hen har ju inte
 * områdena längre, och läggs hen till igen ska en gammal länk inte vakna).
 */
async function dropFrom(ids, recipient) {
  if (!ids.length) return;
  await StudyUnit.updateMany({ _id: { $in: ids } }, { $pull: { sharedWith: recipient, sharedVia: { user: recipient } } });
  await StudyFolder.updateMany({ user: recipient, units: { $in: ids } }, { $pull: { units: { $in: ids } } });
  await StudyFlag.deleteMany({ unit: { $in: ids }, reporter: recipient, status: 'open' });
  const links = await StudyShareLink.find({ creator: recipient, revokedAt: null, $or: [{ unit: { $in: ids } }, { units: { $in: ids } }] });
  for (const link of links) await trimLink(link, ids); // eslint-disable-line no-await-in-loop
}

module.exports = { linkUnitIds, trimLink, dropFrom };
