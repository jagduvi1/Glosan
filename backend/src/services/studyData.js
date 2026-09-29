// Livscykeln för Plugga-data: radera ett område med allt som hör till, rensa
// en användare vid kontoradering, och GDPR-exporten. Samlat här så att
// kontoraderingen (routes/me.js) och framtida radera-verktyg (MCP, appen)
// aldrig kan glömma en collection.
const StudyUnit = require('../models/StudyUnit');
const StudyPage = require('../models/StudyPage');
const StudyItem = require('../models/StudyItem');
const StudyItemState = require('../models/StudyItemState');
const StudyAttempt = require('../models/StudyAttempt');
const StudySession = require('../models/StudySession');
const StudyFolder = require('../models/StudyFolder');
const StudyFlag = require('../models/StudyFlag');

/**
 * Radera områden med genomgångar, kort/övningar och ALLAS progress på dem
 * (även kompisar de delats med), och plocka bort dem ur allas mappar.
 * Svarshistorik och pass (StudyAttempt/StudySession) lämnas kvar som
 * historik — de är denormaliserade och går att läsa utan området.
 */
async function deleteStudyUnitsCascade(unitIds, opts = {}) {
  if (!unitIds.length) return;
  const inUnits = { $in: unitIds };
  await StudyPage.deleteMany({ unit: inUnits }, opts);
  await StudyItem.deleteMany({ unit: inUnits }, opts);
  await StudyItemState.deleteMany({ unit: inUnits }, opts);
  await StudyFlag.deleteMany({ unit: inUnits }, opts);
  await StudyFolder.updateMany({ units: inUnits }, { $pull: { units: inUnits } }, opts);
  await StudySession.updateMany({ units: inUnits }, { $pull: { units: inUnits } }, opts);
  await StudyUnit.deleteMany({ _id: inUnits }, opts);
}

/** Kontoradering: allt användaren skapat och all användarens egen progress. */
async function deleteStudyDataForUser(userId, opts = {}) {
  const own = await StudyUnit.find({ user: userId }, '_id', opts).lean();
  await deleteStudyUnitsCascade(own.map((u) => u._id), opts);
  await StudyItemState.deleteMany({ user: userId }, opts);
  await StudyAttempt.deleteMany({ user: userId }, opts);
  await StudySession.deleteMany({ user: userId }, opts);
  await StudyFolder.deleteMany({ user: userId }, opts);
  await StudyFlag.deleteMany({ reporter: userId }, opts);
  // Ur andras delningar, så jag inte ligger kvar som dangling ref.
  await StudyUnit.updateMany({ sharedWith: userId }, { $pull: { sharedWith: userId } }, opts);
}

/** GDPR-export (Art. 20) av användarens Plugga-data. */
async function exportStudyData(userId) {
  const units = await StudyUnit.find({ user: userId }).lean();
  const unitIds = units.map((u) => u._id);
  const [pages, items, sharedWithMe, folders, sessions, attempts, itemStates, flags] = await Promise.all([
    unitIds.length ? StudyPage.find({ unit: { $in: unitIds } }).lean() : [],
    unitIds.length ? StudyItem.find({ unit: { $in: unitIds } }).lean() : [],
    StudyUnit.find({ sharedWith: userId }, 'title subject term user').populate('user', 'username').lean(),
    StudyFolder.find({ user: userId }).lean(),
    StudySession.find({ user: userId }).lean(),
    StudyAttempt.find({ user: userId }).lean(),
    StudyItemState.find({ user: userId }).lean(),
    StudyFlag.find({ reporter: userId }, 'item unit note status resolutionNote resolvedAt createdAt').lean()
  ]);
  return {
    units: units.map((u) => ({
      ...u,
      sharedWith: undefined,
      pages: pages.filter((p) => String(p.unit) === String(u._id)),
      items: items.filter((i) => String(i.unit) === String(u._id))
    })),
    sharedWithMe: sharedWithMe.map((u) => ({
      title: u.title, subject: u.subject, term: u.term, ownerUsername: u.user?.username
    })),
    folders,
    sessions,
    attempts,
    itemStates,
    reportedErrors: flags
  };
}

module.exports = { deleteStudyUnitsCascade, deleteStudyDataForUser, exportStudyData };
