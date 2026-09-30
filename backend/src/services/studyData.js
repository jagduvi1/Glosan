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
const StudyShareLink = require('../models/StudyShareLink');
const StudyTest = require('../models/StudyTest');
const StudyTestAttempt = require('../models/StudyTestAttempt');
const StudyItemDeletion = require('../models/StudyItemDeletion');

const DELETED_UNIT = 'Raderat område';
const DELETED_TEST = 'Raderat prov';

/**
 * Radera områden med genomgångar, kort/övningar och ALLAS progress på dem
 * (även kompisar de delats med), och plocka bort dem ur allas mappar.
 * Svarshistorik, pass och klara provresultat (StudyAttempt/StudySession/
 * StudyTestAttempt) lämnas kvar som historik — de är denormaliserade och går
 * att läsa utan området. Påbörjade prov kan aldrig bli klara och raderas.
 */
async function deleteStudyUnitsCascade(unitIds, opts = {}) {
  if (!unitIds.length) return;
  const inUnits = { $in: unitIds };
  const tests = await StudyTest.find({ unit: inUnits }, '_id', opts).lean();
  if (tests.length) {
    await StudyTestAttempt.deleteMany({ test: { $in: tests.map((t) => t._id) }, status: { $ne: 'done' } }, opts);
  }
  await StudyPage.deleteMany({ unit: inUnits }, opts);
  await StudyItem.deleteMany({ unit: inUnits }, opts);
  await StudyItemState.deleteMany({ unit: inUnits }, opts);
  await StudyFlag.deleteMany({ unit: inUnits }, opts);
  await StudyShareLink.deleteMany({ unit: inUnits }, opts);
  await StudyTest.deleteMany({ unit: inUnits }, opts);
  await StudyItemDeletion.deleteMany({ unit: inUnits }, opts);
  await StudyFolder.updateMany({ units: inUnits }, { $pull: { units: inUnits } }, opts);
  await StudySession.updateMany({ units: inUnits }, { $pull: { units: inUnits } }, opts);
  await StudyUnit.deleteMany({ _id: inUnits }, opts);
}

/**
 * Kontoradering: allt användaren skapat och all användarens egen progress.
 * I andras historik på mina områden blir titlarna och frågornas text
 * anonyma — det är mitt innehåll, poängen och koderna är deras.
 */
async function deleteStudyDataForUser(userId, opts = {}) {
  const own = await StudyUnit.find({ user: userId }, '_id', opts).lean();
  const ownIds = own.map((u) => u._id);
  if (ownIds.length) {
    const others = { unit: { $in: ownIds }, user: { $ne: userId } };
    await StudyAttempt.updateMany(others, { $set: { unitTitle: DELETED_UNIT } }, opts);
    await StudyTestAttempt.updateMany(others, {
      $set: { unitTitle: DELETED_UNIT, testTitle: DELETED_TEST },
      $unset: { 'answers.$[].prompt': '', 'answers.$[].expected': '', 'answers.$[].solution': '', 'answers.$[].modelAnswer': '' }
    }, opts);
  }
  await deleteStudyUnitsCascade(ownIds, opts);
  await StudyItemState.deleteMany({ user: userId }, opts);
  await StudyAttempt.deleteMany({ user: userId }, opts);
  await StudySession.deleteMany({ user: userId }, opts);
  await StudyTestAttempt.deleteMany({ user: userId }, opts);
  await StudyItemDeletion.deleteMany({ owner: userId }, opts);
  await StudyFolder.deleteMany({ user: userId }, opts);
  await StudyFlag.deleteMany({ reporter: userId }, opts);
  await StudyShareLink.deleteMany({ creator: userId }, opts);
  await StudyShareLink.updateMany({ usedBy: userId }, { $pull: { usedBy: userId } }, opts);
  // Ur andras delningar, så jag inte ligger kvar som dangling ref.
  await StudyUnit.updateMany({ sharedWith: userId }, { $pull: { sharedWith: userId } }, opts);
}

/** GDPR-export (Art. 20) av användarens Plugga-data. */
async function exportStudyData(userId) {
  const units = await StudyUnit.find({ user: userId }).lean();
  const unitIds = units.map((u) => u._id);
  const [pages, items, tests, deletions, sharedWithMe, folders, sessions, attempts, testAttempts, itemStates, flags, links] = await Promise.all([
    unitIds.length ? StudyPage.find({ unit: { $in: unitIds } }).lean() : [],
    unitIds.length ? StudyItem.find({ unit: { $in: unitIds } }).lean() : [],
    unitIds.length ? StudyTest.find({ unit: { $in: unitIds } }).lean() : [],
    unitIds.length ? StudyItemDeletion.find({ unit: { $in: unitIds } }).lean() : [],
    StudyUnit.find({ sharedWith: userId }, 'title subject term user').populate('user', 'username').lean(),
    StudyFolder.find({ user: userId }).lean(),
    StudySession.find({ user: userId }).lean(),
    StudyAttempt.find({ user: userId }).lean(),
    StudyTestAttempt.find({ user: userId }).lean(),
    StudyItemState.find({ user: userId }).lean(),
    StudyFlag.find({ reporter: userId }, 'item unit note status resolutionNote resolvedAt createdAt').lean(),
    StudyShareLink.find({ creator: userId }).lean()
  ]);
  return {
    units: units.map((u) => ({
      ...u,
      sharedWith: undefined,
      pages: pages.filter((p) => String(p.unit) === String(u._id)),
      items: items.filter((i) => String(i.unit) === String(u._id)),
      tests: tests.filter((t) => String(t.unit) === String(u._id)),
      deletedItems: deletions.filter((d) => String(d.unit) === String(u._id))
    })),
    sharedWithMe: sharedWithMe.map((u) => ({
      title: u.title, subject: u.subject, term: u.term, ownerUsername: u.user?.username
    })),
    folders,
    sessions,
    attempts,
    testAttempts,
    itemStates,
    reportedErrors: flags,
    // Vilka som använt länken är andras data — bara antalet exporteras.
    shareLinks: links.map((l) => ({
      unit: l.unit, code: l.code, expiresAt: l.expiresAt, maxUses: l.maxUses,
      usedCount: (l.usedBy || []).length, revokedAt: l.revokedAt, createdAt: l.createdAt
    }))
  };
}

module.exports = { deleteStudyUnitsCascade, deleteStudyDataForUser, exportStudyData };
