// Läsvyer i Plugga: områdeslistor med användarens egen progress och
// områdessidan. Delas av routes/study.js och MCP-verktygen.
const StudyUnit = require('../../models/StudyUnit');
const StudyPage = require('../../models/StudyPage');
const StudyItem = require('../../models/StudyItem');
const StudyItemState = require('../../models/StudyItemState');
const StudyAttempt = require('../../models/StudyAttempt');
const User = require('../../models/User');
const { getSubject, SUBJECT_KEYS, subjectsInGroup } = require('../../config/subjects');
const { isValidTerm, termLabel } = require('../../utils/term');
const { readableFilter, oid, loadUnit } = require('./access');
const { publicItem } = require('./practice');
const { testsForUnit } = require('./tests');
const { issuer } = require('../mcpOAuth');

const MASTERED_BOX = 3;

/** Progress per område för EN användare. Map(unitId → {...}). */
async function unitProgress(userId, unitIds) {
  const now = new Date();
  const ids = unitIds.map(oid);
  const [itemRows, stateRows] = await Promise.all([
    StudyItem.aggregate([
      { $match: { unit: { $in: ids }, usage: 'practice' } },
      { $group: { _id: { unit: '$unit', kind: '$kind', level: '$level' }, n: { $sum: 1 } } }
    ]),
    StudyItemState.aggregate([
      { $match: { user: oid(userId), unit: { $in: ids } } },
      {
        $group: {
          _id: '$unit',
          seen: { $sum: 1 },
          mastered: { $sum: { $cond: [{ $gte: ['$box', MASTERED_BOX] }, 1, 0] } },
          due: { $sum: { $cond: [{ $lte: ['$dueAt', now] }, 1, 0] } }
        }
      }
    ])
  ]);
  const out = new Map(ids.map((id) => [String(id), {
    cards: 0, exercises: 0, levels: { E: 0, C: 0, A: 0 }, total: 0, seen: 0, mastered: 0, due: 0, new: 0
  }]));
  for (const r of itemRows) {
    const p = out.get(String(r._id.unit));
    if (!p) continue;
    p.total += r.n;
    if (r._id.kind === 'card') p.cards += r.n;
    else p.exercises += r.n;
    if (r._id.level && p.levels[r._id.level] !== undefined) p.levels[r._id.level] += r.n;
  }
  for (const r of stateRows) {
    const p = out.get(String(r._id));
    if (!p) continue;
    Object.assign(p, { seen: r.seen, mastered: r.mastered, due: r.due });
  }
  for (const p of out.values()) p.new = Math.max(0, p.total - p.seen);
  return out;
}

function unitUrl(unit) {
  return `${issuer()}/plugga/omrade/${unit._id}`;
}

function folderUrl(folderId) {
  return `${issuer()}/plugga/mapp/${folderId}`;
}

function testUrl(testId) {
  return `${issuer()}/plugga/prov/${testId}`;
}

function unitSummary(u, userId, progress, ownerName) {
  const isOwner = String(u.user?._id || u.user) === String(userId);
  const subject = getSubject(u.subject);
  return {
    id: String(u._id),
    code: u.code,
    title: u.title,
    description: u.description || '',
    subject: u.subject,
    subjectLabel: subject?.label || u.subject,
    emoji: subject?.emoji || '',
    term: u.term,
    termLabel: termLabel(u.term),
    gradeYear: u.gradeYear ?? null,
    examDate: u.examDate || null,
    source: u.source || {},
    isOwner,
    sharedBy: isOwner ? null : ownerName || null,
    // Hur många skaparen delat med — bara skaparen får veta det.
    sharedCount: isOwner ? (u.sharedWith || []).length : null,
    progress,
    url: unitUrl(u),
    updatedAt: u.updatedAt
  };
}

/** Områden användaren kan läsa, filtrerade på ämne/grupp/termin. */
async function listUnits(userId, { subject, group, term, allTerms } = {}) {
  const filter = { ...readableFilter(userId), archivedAt: null };
  if (SUBJECT_KEYS.includes(subject)) filter.subject = subject;
  else if (group === 'no' || group === 'so') filter.subject = { $in: subjectsInGroup(group) };
  if (isValidTerm(term) && !allTerms) filter.term = term;
  const units = await StudyUnit.find(filter).sort({ createdAt: -1 }).populate('user', 'username').lean();
  const progress = await unitProgress(userId, units.map((u) => u._id));
  return units.map((u) => unitSummary(u, userId, progress.get(String(u._id)), u.user?.username));
}

/**
 * Områdessidan: genomgångar, alla kort/övningar (utan facit) med elevens
 * egen progress och senaste AI-rättade papperslösning per uppgift.
 */
async function unitDetail(userId, unitId) {
  const access = await loadUnit(userId, unitId, 'read');
  if (access.error) return access;
  const { unit } = access;
  const [pages, items, owner] = await Promise.all([
    StudyPage.find({ unit: unit._id }).sort({ order: 1, createdAt: 1 }).lean(),
    StudyItem.find({ unit: unit._id, usage: 'practice' }).sort({ number: 1 }).lean(),
    User.findById(unit.user, 'username').lean()
  ]);
  const itemIds = items.map((i) => i._id);
  const [states, papers, progress, tests] = await Promise.all([
    StudyItemState.find({ user: userId, item: { $in: itemIds } }).lean(),
    StudyAttempt.aggregate([
      { $match: { user: oid(userId), unit: unit._id, source: 'paper' } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$item', result: { $first: '$result' }, feedback: { $first: '$feedback' }, at: { $first: '$createdAt' } } }
    ]),
    unitProgress(userId, [unit._id]),
    testsForUnit(userId, unit)
  ]);
  const stateBy = new Map(states.map((s) => [String(s.item), s]));
  const paperBy = new Map(papers.map((p) => [String(p._id), p]));
  // Nivåstegen: hur mycket som sitter per nivå (övningar med nivå).
  const levelProgress = { E: { total: 0, mastered: 0 }, C: { total: 0, mastered: 0 }, A: { total: 0, mastered: 0 } };
  for (const i of items) {
    if (i.kind !== 'exercise' || !levelProgress[i.level]) continue;
    levelProgress[i.level].total += 1;
    if ((stateBy.get(String(i._id))?.box || 0) >= MASTERED_BOX) levelProgress[i.level].mastered += 1;
  }
  const u = unit.toObject();
  return {
    unit: unitSummary(u, userId, progress.get(String(unit._id)), owner?.username),
    pages: pages.map((p) => ({ id: String(p._id), title: p.title, body: p.body, order: p.order })),
    tests,
    levelProgress,
    items: items.map((i) => {
      const s = stateBy.get(String(i._id));
      const paper = paperBy.get(String(i._id));
      return {
        ...publicItem(i, u),
        state: s ? { box: s.box, dueAt: s.dueAt, correct: s.correct, wrong: s.wrong, lastResult: s.lastResult } : null,
        lastPaper: paper ? { result: paper.result, feedback: paper.feedback, at: paper.at } : null
      };
    })
  };
}

module.exports = { unitProgress, listUnits, unitDetail, unitSummary, unitUrl, folderUrl, testUrl, MASTERED_BOX };

