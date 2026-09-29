// Plugga-verktyg: användarens AI skapar områden (genomgångar, kort, övningar)
// från foton ur läroboken, rättar papperslösningar och fixar rapporterade
// fel. Alla verktyg kräver funktionsflaggan 'study' — för andra användare
// finns de inte. Glosan anropar ALDRIG någon AI här; AI:n är användarens egen.
const { z } = require('zod');
const StudyUnit = require('../../models/StudyUnit');
const StudyPage = require('../../models/StudyPage');
const StudyItem = require('../../models/StudyItem');
const StudyItemState = require('../../models/StudyItemState');
const StudyAttempt = require('../../models/StudyAttempt');
const StudyFlag = require('../../models/StudyFlag');
const { SUBJECT_KEYS, getSubject } = require('../../config/subjects');
const { termFor, termLabel } = require('../../utils/term');
const { registerTool } = require('../registry');
const { objectId, ok, fail, validationMessage } = require('../toolUtil');
const { loadUnit, loadItem, findItemByCode, itemCode, isId, oid } = require('../../services/study/access');
const { listUnits, unitUrl, folderUrl } = require('../../services/study/views');
const { recordPaperAttempt } = require('../../services/study/practice');
const { listFolders, createFolder, updateFolder, COLORS } = require('../../services/study/folders');
const { deleteStudyUnitsCascade } = require('../../services/studyData');
const { parseStudyCode } = require('../../utils/studyCodes');

const FEATURE = 'study';
const MAX_UNITS_PER_USER = 1000;
const MAX_PAGES_PER_UNIT = 30;
const MAX_ITEMS_PER_UNIT = 500;

const MSG_UNIT_NOT_FOUND = 'No such unit, or no access to it. Use list_study_units for valid unit ids and codes.';
const MSG_ITEM_NOT_FOUND = 'No such card/exercise. Codes look like "MA3-14"; get_study_unit lists every code in a unit.';
const MSG_OWNER_ONLY = 'Only the creator of this unit can change its content — it was shared with the user. Ask the creator, or create your own unit.';

// ── zod-former ───────────────────────────────────────────────────────────────
const subjectKey = z.enum(SUBJECT_KEYS);
const level = z.enum(['E', 'C', 'A']);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const termKey = z.string().regex(/^20\d{2}-(HT|VT)$/, 'use e.g. "2026-HT" or "2027-VT"');

const pageInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(20000).describe('Markdown; formulas in LaTeX between $…$ (inline) or $$…$$ (block)')
});

const cardInput = z.object({
  front: z.string().trim().min(1).max(4000).describe('Question or term (Markdown + LaTeX)'),
  back: z.string().trim().min(1).max(4000).describe('Answer or explanation'),
  level: level.optional(),
  skill: z.string().trim().max(80).optional()
});

const answerInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('number'),
    value: z.number().describe('The exact answer as a number (use a dot in JSON: 3.5)'),
    tolerance: z.number().min(0).optional().describe('Allowed deviation, e.g. 0.05 when the answer is rounded to one decimal'),
    unit: z.string().trim().max(20).optional().describe('e.g. "cm", "kr", "%", "m/s" — a missing unit is forgiven, a wrong one is not')
  }),
  z.object({
    type: z.literal('choice'),
    choices: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
    correct_index: z.number().int().min(0).describe('0-based index of the correct choice')
  }),
  z.object({
    type: z.literal('text'),
    accepted: z.array(z.string().trim().min(1).max(200)).min(1).max(10).describe('Accepted answers, e.g. ["fotosyntes", "fotosyntesen"]')
  }),
  z.object({
    type: z.literal('self'),
    model_answer: z.string().trim().min(1).max(4000).describe('Model answer; for SO/NO/history describe what an E, C and A answer contains')
  })
]);

const exerciseInput = z.object({
  prompt: z.string().trim().min(1).max(4000).describe('The task (Markdown + LaTeX)'),
  answer: answerInput,
  solution: z.string().trim().max(8000).optional().describe('Worked solution, step by step — required for number/choice/text'),
  hints: z.array(z.string().trim().min(1).max(1000)).max(5).optional().describe('1–3 hints that nudge without giving the answer away'),
  level: level.describe('E = easy (lätt), C = medium, A = hard — follow the book\'s own level markings'),
  skill: z.string().trim().max(80).optional().describe('What it trains, e.g. "ekvationer med x i båda led"'),
  source_ref: z.string().trim().max(60).optional().describe('The book exercise it is modelled on, e.g. "uppg 3.14"')
});

// ── hjälpare ─────────────────────────────────────────────────────────────────
const toDate = (s) => (s ? new Date(`${s}T12:00:00Z`) : null);

function unitError(access) {
  return access.error === 'forbidden' ? fail('forbidden', MSG_OWNER_ONLY) : fail('not_found', MSG_UNIT_NOT_FOUND);
}

function answerOut(a) {
  if (!a) return null;
  switch (a.type) {
    case 'number': return { type: 'number', value: a.value, tolerance: a.tolerance || 0, unit: a.unit || '' };
    case 'choice': return { type: 'choice', choices: a.choices, correct_index: a.correctIndex };
    case 'text': return { type: 'text', accepted: a.accepted };
    case 'self': return { type: 'self', model_answer: a.modelAnswer };
    default: return null;
  }
}

function answerIn(a) {
  switch (a.type) {
    case 'number': return { type: 'number', value: a.value, tolerance: a.tolerance || 0, unit: a.unit || '' };
    case 'choice': return { type: 'choice', choices: a.choices, correctIndex: a.correct_index };
    case 'text': return { type: 'text', accepted: a.accepted };
    case 'self': return { type: 'self', modelAnswer: a.model_answer };
    default: return undefined;
  }
}

/** Ett kort/en övning MED facit — för AI:n (skapa, kontrollera, rätta papper). */
function itemFull(item, unit) {
  return {
    item_id: String(item._id),
    code: itemCode(unit, item),
    kind: item.kind,
    prompt: item.prompt,
    ...(item.kind === 'card' ? { back: item.back } : { answer: answerOut(item.answer) }),
    ...(item.solution ? { solution: item.solution } : {}),
    ...(item.hints?.length ? { hints: item.hints } : {}),
    level: item.level || null,
    ...(item.skill ? { skill: item.skill } : {}),
    ...(item.sourceRef ? { source_ref: item.sourceRef } : {})
  };
}

function unitMeta(unit) {
  return {
    unit_id: String(unit._id),
    code: unit.code,
    title: unit.title,
    subject: unit.subject,
    subject_label: getSubject(unit.subject)?.label || unit.subject,
    term: unit.term,
    term_label: termLabel(unit.term),
    grade_year: unit.gradeYear ?? null,
    exam_date: unit.examDate ? unit.examDate.toISOString().slice(0, 10) : null,
    source: unit.source || {},
    url: unitUrl(unit)
  };
}

/** Resolve an item from { item_id } or { code } (the paper-flow code). */
async function resolveItem(ctx, args, level = 'read') {
  if (args.item_id) {
    const access = await loadItem(ctx.user.id, args.item_id, level);
    if (access.error === 'forbidden') return { error: fail('forbidden', MSG_OWNER_ONLY) };
    if (access.error) return { error: fail('not_found', MSG_ITEM_NOT_FOUND) };
    return access;
  }
  if (args.code) {
    const found = await findItemByCode(ctx.user.id, args.code);
    if (found.error === 'invalid_code') return { error: fail('invalid_input', 'That is not a valid exercise code. Codes look like "MA3-14" (subject + unit number, dash, exercise number). If the photo is unclear, ask the student.') };
    if (found.error === 'ambiguous') {
      return { error: fail('conflict', `The code matches several units: ${found.candidates.map((c) => `${c.title} (by ${c.owner}, unit_id ${c.unit_id})`).join('; ')}. Ask which one, then use item_id from get_study_unit.`) };
    }
    if (found.error) return { error: fail('not_found', MSG_ITEM_NOT_FOUND) };
    if (level === 'owner' && !found.isOwner) return { error: fail('forbidden', MSG_OWNER_ONLY) };
    return found;
  }
  return { error: fail('invalid_input', 'Pass item_id or code.') };
}

// ── läsverktyg ───────────────────────────────────────────────────────────────

registerTool({
  name: 'list_study_units',
  title: 'List study units (Plugga)',
  description:
    'Lists the user\'s study units ("områden") in Plugga — their own and ones friends shared — with code (e.g. MA3), subject, term, årskurs, test date and the user\'s progress (total, mastered, due, new). ' +
    'Call it before creating a unit (to see the grade used last time and avoid duplicates) and to find unit ids.',
  scope: 'read',
  feature: FEATURE,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    subject: subjectKey.optional(),
    term: termKey.optional().describe('Default: all terms'),
    group: z.enum(['no', 'so']).optional().describe('All NO or all SO subjects')
  },
  handler: async (args, ctx) => {
    const units = await listUnits(ctx.user.id, { subject: args.subject, group: args.group, term: args.term, allTerms: !args.term });
    const data = units.map((u) => ({
      unit_id: u.id,
      code: u.code,
      title: u.title,
      subject: u.subject,
      term: u.term,
      grade_year: u.gradeYear,
      exam_date: u.examDate ? new Date(u.examDate).toISOString().slice(0, 10) : null,
      is_owner: u.isOwner,
      ...(u.sharedBy ? { shared_by: u.sharedBy } : {}),
      ...(u.isOwner && u.sharedCount ? { shared_with: u.sharedCount } : {}),
      cards: u.progress.cards,
      exercises: u.progress.exercises,
      levels: u.progress.levels,
      progress: { mastered: u.progress.mastered, due: u.progress.due, new: u.progress.new },
      url: u.url
    }));
    return ok(`${data.length} unit(s)`, data);
  }
});

registerTool({
  name: 'get_study_unit',
  title: 'Get a study unit with all content',
  description:
    'Returns one unit with its genomgångar (explanations) and every card and exercise INCLUDING answers, worked solutions and codes. ' +
    'Use it to verify what you created (re-solve every exercise), to avoid duplicates when adding more, and to fix errors.',
  scope: 'read',
  feature: FEATURE,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    unit_id: objectId.optional(),
    code: z.string().trim().max(8).optional().describe('Unit code, e.g. "MA3"'),
    include_pages: z.boolean().optional().describe('Default true'),
    include_items: z.boolean().optional().describe('Default true')
  },
  handler: async (args, ctx) => {
    let unit;
    if (args.unit_id) {
      const access = await loadUnit(ctx.user.id, args.unit_id, 'read');
      if (access.error) return unitError(access);
      unit = access.unit;
    } else if (args.code) {
      const units = await listUnits(ctx.user.id, { allTerms: true });
      const match = units.filter((u) => u.code === args.code.toUpperCase());
      const own = match.filter((u) => u.isOwner);
      const pick = own.length === 1 ? own[0] : (match.length === 1 ? match[0] : null);
      if (!pick) return match.length ? fail('conflict', 'Several units have that code — use unit_id from list_study_units.') : fail('not_found', MSG_UNIT_NOT_FOUND);
      unit = (await loadUnit(ctx.user.id, pick.id, 'read')).unit;
    } else {
      return fail('invalid_input', 'Pass unit_id or code.');
    }
    const [pages, items] = await Promise.all([
      args.include_pages === false ? [] : StudyPage.find({ unit: unit._id }).sort({ order: 1, createdAt: 1 }).lean(),
      args.include_items === false ? [] : StudyItem.find({ unit: unit._id }).sort({ number: 1 }).lean()
    ]);
    return ok(`"${unit.title}" (${unit.code}) — ${pages.length} page(s), ${items.length} card(s)/exercise(s)`, {
      ...unitMeta(unit),
      is_owner: String(unit.user) === String(ctx.user.id),
      pages: pages.map((p) => ({ page_id: String(p._id), title: p.title, body: p.body, order: p.order })),
      items: items.map((i) => itemFull(i, unit))
    });
  }
});

registerTool({
  name: 'get_study_item',
  title: 'Look up an exercise by code',
  description:
    'Fetches ONE card/exercise by the code the student wrote on paper (e.g. "MA3-14") or by item_id — with answer, worked solution, hints and level, ' +
    'plus the student\'s own history on it (earlier attempts and feedback). Use it to check a photographed handwritten solution.',
  scope: 'read',
  feature: FEATURE,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    code: z.string().trim().max(20).optional().describe('e.g. "MA3-14" — tolerant of "ma3 14", "MA 3–14"'),
    item_id: objectId.optional()
  },
  handler: async (args, ctx) => {
    const r = await resolveItem(ctx, args, 'read');
    if (r.error) return r.error;
    const { item, unit } = r;
    const [state, history] = await Promise.all([
      StudyItemState.findOne({ user: ctx.user.id, item: item._id }).lean(),
      StudyAttempt.find({ user: ctx.user.id, item: item._id }).sort({ createdAt: -1 }).limit(5).lean()
    ]);
    return ok(`${itemCode(unit, item)} in "${unit.title}"`, {
      ...itemFull(item, unit),
      unit: unitMeta(unit),
      my_progress: state ? { box: state.box, correct: state.correct, wrong: state.wrong, last_result: state.lastResult } : null,
      my_history: history.map((h) => ({
        at: h.createdAt, source: h.source, result: h.result, ...(h.given ? { given: h.given } : {}), ...(h.feedback ? { feedback: h.feedback } : {})
      }))
    });
  }
});

registerTool({
  name: 'get_study_progress',
  title: 'Study progress',
  description:
    'The student\'s progress in one unit (mastered/total per level, and the exercises they keep missing, with codes) or across a subject/term. ' +
    'Use it to decide what to practise next or which skills need new exercises.',
  scope: 'read',
  feature: FEATURE,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    unit_id: objectId.optional(),
    subject: subjectKey.optional(),
    term: termKey.optional()
  },
  handler: async (args, ctx) => {
    if (args.unit_id) {
      const access = await loadUnit(ctx.user.id, args.unit_id, 'read');
      if (access.error) return unitError(access);
      const { unit } = access;
      const items = await StudyItem.find({ unit: unit._id, usage: 'practice' }).sort({ number: 1 }).lean();
      const states = await StudyItemState.find({ user: ctx.user.id, item: { $in: items.map((i) => i._id) } }).lean();
      const byItem = new Map(states.map((s) => [String(s.item), s]));
      const perLevel = {};
      const weak = [];
      for (const it of items) {
        const key = it.level || 'none';
        perLevel[key] = perLevel[key] || { total: 0, mastered: 0, seen: 0 };
        perLevel[key].total += 1;
        const s = byItem.get(String(it._id));
        if (s) {
          perLevel[key].seen += 1;
          if (s.box >= 3) perLevel[key].mastered += 1;
          if (s.lastResult === 'wrong' || (s.wrong || 0) > (s.correct || 0)) {
            weak.push({ code: itemCode(unit, it), skill: it.skill || null, level: it.level, correct: s.correct, wrong: s.wrong });
          }
        }
      }
      return ok(`Progress in "${unit.title}"`, { ...unitMeta(unit), per_level: perLevel, keeps_missing: weak });
    }
    const units = await listUnits(ctx.user.id, { subject: args.subject, term: args.term, allTerms: !args.term });
    return ok(`${units.length} unit(s)`, units.map((u) => ({
      unit_id: u.id, code: u.code, title: u.title, subject: u.subject, term: u.term,
      total: u.progress.total, mastered: u.progress.mastered, due: u.progress.due, new: u.progress.new
    })));
  }
});

registerTool({
  name: 'list_study_flags',
  title: 'List reported errors',
  description:
    'Open "fel i facit" reports on units the user CREATED — students (the user or friends it was shared with) flag cards/exercises they think are wrong. ' +
    'Verify each one, fix it with update_study_item if it really is wrong, then close it with resolve_study_flag.',
  scope: 'read',
  feature: FEATURE,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { unit_id: objectId.optional() },
  handler: async (args, ctx) => {
    const q = { owner: ctx.user.id, status: 'open' };
    if (args.unit_id) q.unit = args.unit_id;
    const flags = await StudyFlag.find(q).sort({ createdAt: 1 }).limit(100)
      .populate('item').populate('unit').populate('reporter', 'username').lean();
    const data = flags.filter((f) => f.item && f.unit).map((f) => ({
      flag_id: String(f._id),
      code: itemCode(f.unit, f.item),
      unit_title: f.unit.title,
      reported_by: String(f.reporter?._id) === String(ctx.user.id) ? 'the user' : (f.reporter?.username || 'a friend'),
      note: f.note || '',
      reported_at: f.createdAt,
      item: itemFull(f.item, f.unit)
    }));
    return ok(`${data.length} open report(s)`, data);
  }
});

// ── skrivverktyg ─────────────────────────────────────────────────────────────

registerTool({
  name: 'create_study_unit',
  title: 'Create a study unit (område)',
  description:
    'Creates a unit ("område") for a school subject, e.g. "Kapitel 3 — Ekvationer", optionally with its genomgångar (explanations). ' +
    'BEFORE calling: ask the student\'s årskurs (grade_year) — never guess — and propose what you will create. ' +
    'Then add flashcards and exercises with add_flashcards / add_exercises. Returns unit_id, the unit code (e.g. MA3) and a url.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    subject: subjectKey,
    grade_year: z.number().int().min(1).max(9).describe('The student\'s årskurs (1–9) — ASK the student'),
    title: z.string().trim().min(1).max(120).describe('e.g. "Kapitel 3 — Ekvationer"'),
    term: termKey.optional().describe('Default: the current term'),
    description: z.string().trim().max(1000).optional(),
    source: z.object({
      book: z.string().trim().max(120).optional(),
      chapter: z.string().trim().max(120).optional(),
      pages: z.string().trim().max(60).optional()
    }).optional().describe('Where the material comes from, e.g. { book: "Matte Direkt 8", chapter: "3 Ekvationer", pages: "98–124" }'),
    exam_date: dateStr.optional().describe('Test date if there is one (YYYY-MM-DD)'),
    pages: z.array(pageInput).max(10).optional().describe('Genomgångar: explanation, "så gör du" step by step, examples, common mistakes')
  },
  handler: async (args, ctx) => {
    const count = await StudyUnit.countDocuments({ user: ctx.user.id });
    if (count >= MAX_UNITS_PER_USER) return fail('invalid_input', `The user already has ${count} units — archive or delete old ones first.`);
    const code = await StudyUnit.nextCode(ctx.user.id, args.subject);
    let unit;
    try {
      unit = await StudyUnit.create({
        user: ctx.user.id,
        subject: args.subject,
        term: args.term || termFor(),
        gradeYear: args.grade_year,
        code,
        title: args.title,
        description: args.description || '',
        source: args.source || {},
        examDate: toDate(args.exam_date)
      });
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }
    const pages = args.pages || [];
    if (pages.length) {
      await StudyPage.insertMany(pages.map((p, i) => ({ unit: unit._id, user: ctx.user.id, title: p.title, body: p.body, order: i })));
    }
    return ok(`Created ${code} "${unit.title}" (${getSubject(unit.subject).label}, ${termLabel(unit.term)}, åk ${unit.gradeYear})`, {
      ...unitMeta(unit),
      pages_added: pages.length,
      next: 'Add flashcards (add_flashcards) and exercises on every level (add_exercises), then verify with get_study_unit.'
    });
  }
});

registerTool({
  name: 'add_study_pages',
  title: 'Add genomgångar',
  description: 'Adds genomgångar (explanation pages: Markdown + LaTeX) to a unit you created.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: { unit_id: objectId, pages: z.array(pageInput).min(1).max(10) },
  handler: async (args, ctx) => {
    const access = await loadUnit(ctx.user.id, args.unit_id, 'owner');
    if (access.error) return unitError(access);
    const existing = await StudyPage.countDocuments({ unit: access.unit._id });
    if (existing + args.pages.length > MAX_PAGES_PER_UNIT) return fail('invalid_input', `A unit holds at most ${MAX_PAGES_PER_UNIT} pages (it has ${existing}).`);
    const docs = await StudyPage.insertMany(args.pages.map((p, i) => ({
      unit: access.unit._id, user: ctx.user.id, title: p.title, body: p.body, order: existing + i
    })));
    return ok(`Added ${docs.length} page(s) to ${access.unit.code}`, docs.map((d) => ({ page_id: String(d._id), title: d.title })));
  }
});

registerTool({
  name: 'update_study_page',
  title: 'Edit a genomgång',
  description: 'Changes the title, text or order of a genomgång page in a unit you created.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    page_id: objectId,
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().min(1).max(20000).optional(),
    order: z.number().int().min(0).max(100).optional()
  },
  handler: async (args, ctx) => {
    const page = isId(args.page_id) ? await StudyPage.findById(args.page_id) : null;
    if (!page) return fail('not_found', 'No such page. get_study_unit lists page ids.');
    const access = await loadUnit(ctx.user.id, page.unit, 'owner');
    if (access.error) return unitError(access);
    if (args.title !== undefined) page.title = args.title;
    if (args.body !== undefined) page.body = args.body;
    if (args.order !== undefined) page.order = args.order;
    await page.save();
    return ok(`Updated page "${page.title}"`, { page_id: String(page._id), title: page.title });
  }
});

async function insertItems(ctx, unit, docs) {
  const existing = await StudyItem.countDocuments({ unit: unit._id });
  if (existing + docs.length > MAX_ITEMS_PER_UNIT) {
    return { error: fail('invalid_input', `A unit holds at most ${MAX_ITEMS_PER_UNIT} cards/exercises (it has ${existing}). Create a new unit for the rest.`) };
  }
  const first = await StudyUnit.reserveItemNumbers(unit._id, docs.length);
  try {
    const inserted = await StudyItem.insertMany(docs.map((d, i) => ({ ...d, unit: unit._id, user: ctx.user.id, number: first + i })));
    return { inserted };
  } catch (err) {
    if (err.name === 'ValidationError') return { error: fail('invalid_input', validationMessage(err)) };
    throw err;
  }
}

registerTool({
  name: 'add_flashcards',
  title: 'Add flashcards',
  description:
    'Adds flashcards (kort) to a unit you created: key terms (begrepp), rules, formulas, facts — one idea per card. ' +
    'The student flips the card and rates themselves. Returns each card\'s code.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: { unit_id: objectId, cards: z.array(cardInput).min(1).max(100) },
  handler: async (args, ctx) => {
    const access = await loadUnit(ctx.user.id, args.unit_id, 'owner');
    if (access.error) return unitError(access);
    const r = await insertItems(ctx, access.unit, args.cards.map((c) => ({
      kind: 'card', prompt: c.front, back: c.back, level: c.level || null, skill: c.skill || ''
    })));
    if (r.error) return r.error;
    return ok(`Added ${r.inserted.length} card(s) to ${access.unit.code}`, {
      codes: r.inserted.map((i) => itemCode(access.unit, i)),
      url: unitUrl(access.unit)
    });
  }
});

registerTool({
  name: 'add_exercises',
  title: 'Add exercises',
  description:
    'Adds exercises (övningar) to a unit you created — your OWN exercises modelled on the book\'s (put the book exercise in source_ref), on levels E/C/A following the book\'s level markings. ' +
    'Answer types: number (calculations), choice, text (short facts), self (open "förklara/resonera/visa" questions with a model answer). ' +
    'Every number/choice/text exercise needs a worked solution. Returns each exercise\'s code (e.g. MA3-14) — the student writes it on paper when solving by hand.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: { unit_id: objectId, exercises: z.array(exerciseInput).min(1).max(60) },
  handler: async (args, ctx) => {
    const access = await loadUnit(ctx.user.id, args.unit_id, 'owner');
    if (access.error) return unitError(access);
    const warnings = [];
    for (const [i, ex] of args.exercises.entries()) {
      if (ex.answer.type === 'choice' && ex.answer.correct_index >= ex.answer.choices.length) {
        return fail('invalid_input', `Exercise ${i + 1}: correct_index ${ex.answer.correct_index} is outside its ${ex.answer.choices.length} choices.`);
      }
      if (ex.answer.type !== 'self' && !(ex.solution && ex.solution.trim())) {
        return fail('invalid_input', `Exercise ${i + 1}: add a worked solution (step by step) — every calculated or closed exercise needs one.`);
      }
      if (ex.answer.type === 'number' && !Number.isInteger(ex.answer.value) && !ex.answer.tolerance) {
        warnings.push(`Exercise ${i + 1}: the answer ${ex.answer.value} is not an integer and has no tolerance — a student who rounds will be marked wrong. Consider a tolerance.`);
      }
    }
    const r = await insertItems(ctx, access.unit, args.exercises.map((ex) => ({
      kind: 'exercise',
      prompt: ex.prompt,
      answer: answerIn(ex.answer),
      solution: ex.solution || '',
      hints: ex.hints || [],
      level: ex.level,
      skill: ex.skill || '',
      sourceRef: ex.source_ref || ''
    })));
    if (r.error) return r.error;
    const levels = r.inserted.reduce((m, i) => ({ ...m, [i.level]: (m[i.level] || 0) + 1 }), {});
    return ok(`Added ${r.inserted.length} exercise(s) to ${access.unit.code} (${Object.entries(levels).map(([k, v]) => `${v} ${k}`).join(', ')})`, {
      codes: r.inserted.map((i) => itemCode(access.unit, i)),
      url: unitUrl(access.unit)
    }, warnings.length ? { warnings } : {});
  }
});

registerTool({
  name: 'update_study_item',
  title: 'Correct a card or exercise',
  description:
    'Changes a card or exercise in a unit you created — fix a wrong answer, improve a solution or hint, change the level. Only the fields you pass change. ' +
    'Use it after verifying your own content and when resolving "fel i facit" reports.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    item_id: objectId.optional(),
    code: z.string().trim().max(20).optional(),
    prompt: z.string().trim().min(1).max(4000).optional(),
    back: z.string().trim().min(1).max(4000).optional().describe('Cards only'),
    answer: answerInput.optional().describe('Exercises only — replaces the whole answer'),
    solution: z.string().trim().max(8000).optional(),
    hints: z.array(z.string().trim().min(1).max(1000)).max(5).optional(),
    level: level.optional(),
    skill: z.string().trim().max(80).optional(),
    source_ref: z.string().trim().max(60).optional()
  },
  handler: async (args, ctx) => {
    const r = await resolveItem(ctx, args, 'owner');
    if (r.error) return r.error;
    const { item, unit } = r;
    if (item.kind === 'card' && args.answer) return fail('invalid_input', 'A card has no answer spec — change its back instead.');
    if (item.kind === 'exercise' && args.back) return fail('invalid_input', 'An exercise has no back side — change its answer or solution instead.');
    if (args.answer?.type === 'choice' && args.answer.correct_index >= args.answer.choices.length) {
      return fail('invalid_input', 'correct_index is outside the choices.');
    }
    const set = { prompt: 'prompt', back: 'back', solution: 'solution', hints: 'hints', level: 'level', skill: 'skill', source_ref: 'sourceRef' };
    const changed = [];
    for (const [arg, field] of Object.entries(set)) {
      if (args[arg] !== undefined) { item[field] = args[arg]; changed.push(arg); }
    }
    if (args.answer) { item.answer = answerIn(args.answer); changed.push('answer'); }
    if (!changed.length) return fail('invalid_input', 'Nothing to change — pass at least one field.');
    try {
      await item.save();
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }
    return ok(`Updated ${changed.join(', ')} on ${itemCode(unit, item)}`, itemFull(item, unit));
  }
});

registerTool({
  name: 'delete_study_items',
  title: 'Delete cards or exercises',
  description:
    'Permanently deletes cards/exercises from a unit you created, with everyone\'s progress on them. Codes are never reused. ' +
    'Confirm with the student first, naming the codes.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    unit_id: objectId,
    codes: z.array(z.string().trim().max(20)).min(1).max(100).describe('e.g. ["MA3-14", "MA3-15"]')
  },
  handler: async (args, ctx) => {
    const access = await loadUnit(ctx.user.id, args.unit_id, 'owner');
    if (access.error) return unitError(access);
    const { unit } = access;
    const numbers = [];
    for (const c of args.codes) {
      // Exakt områdeskod — "MA12-4" får aldrig tolkas som "MA1-4".
      const parsed = parseStudyCode(c);
      if (!parsed || parsed.number === null || parsed.unitCode !== unit.code) {
        return fail('invalid_input', `"${c}" is not a code in ${unit.code} (expected like ${unit.code}-14).`);
      }
      numbers.push(parsed.number);
    }
    const items = await StudyItem.find({ unit: unit._id, number: { $in: numbers } }, '_id number').lean();
    const ids = items.map((i) => i._id);
    await StudyItem.deleteMany({ _id: { $in: ids } });
    await StudyItemState.deleteMany({ item: { $in: ids } });
    await StudyFlag.deleteMany({ item: { $in: ids } });
    const deleted = items.map((i) => `${unit.code}-${i.number}`);
    const missing = numbers.filter((n) => !items.some((i) => i.number === n)).map((n) => `${unit.code}-${n}`);
    return ok(`Deleted ${deleted.length} item(s) from ${unit.code}`, { deleted, ...(missing.length ? { not_found: missing } : {}) });
  }
});

registerTool({
  name: 'update_study_unit',
  title: 'Edit a study unit',
  description:
    'Changes a unit you created: title, description, term, årskurs, test date (null to clear), source, or archive it (hides it from lists). ' +
    'The subject cannot change (the code prefix depends on it) — create a new unit instead.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    unit_id: objectId,
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    term: termKey.optional(),
    grade_year: z.number().int().min(1).max(9).optional(),
    exam_date: dateStr.nullable().optional(),
    source: z.object({
      book: z.string().trim().max(120).optional(),
      chapter: z.string().trim().max(120).optional(),
      pages: z.string().trim().max(60).optional()
    }).optional(),
    archived: z.boolean().optional()
  },
  handler: async (args, ctx) => {
    const access = await loadUnit(ctx.user.id, args.unit_id, 'owner');
    if (access.error) return unitError(access);
    const { unit } = access;
    const changed = [];
    const set = (field, value, label) => { if (value !== undefined) { unit[field] = value; changed.push(label); } };
    set('title', args.title, 'title');
    set('description', args.description, 'description');
    set('term', args.term, 'term');
    set('gradeYear', args.grade_year, 'grade_year');
    if (args.exam_date !== undefined) set('examDate', args.exam_date === null ? null : toDate(args.exam_date), 'exam_date');
    if (args.source) {
      set('source', {
        book: args.source.book ?? unit.source?.book ?? '',
        chapter: args.source.chapter ?? unit.source?.chapter ?? '',
        pages: args.source.pages ?? unit.source?.pages ?? ''
      }, 'source');
    }
    if (args.archived !== undefined) set('archivedAt', args.archived ? new Date() : null, 'archived');
    if (!changed.length) return fail('invalid_input', 'Nothing to change — pass at least one field.');
    try {
      await unit.save();
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }
    return ok(`Updated ${changed.join(', ')} on ${unit.code}`, unitMeta(unit));
  }
});

registerTool({
  name: 'delete_study_unit',
  title: 'Delete a study unit',
  description:
    'Permanently deletes a unit you created with all its genomgångar, cards and exercises — also for friends it was shared with, and everyone\'s progress on it. ' +
    'Cannot be undone; archiving (update_study_unit archived:true) is often better. Always confirm with the student first, naming the unit.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: { unit_id: objectId },
  handler: async (args, ctx) => {
    const access = await loadUnit(ctx.user.id, args.unit_id, 'owner');
    if (access.error) return unitError(access);
    const { unit } = access;
    const items = await StudyItem.countDocuments({ unit: unit._id });
    await deleteStudyUnitsCascade([unit._id]);
    return ok(`Deleted ${unit.code} "${unit.title}" and its ${items} card(s)/exercise(s)`, { unit_id: String(unit._id), code: unit.code });
  }
});

registerTool({
  name: 'record_paper_attempt',
  title: 'Record a checked paper solution',
  description:
    'After checking a photographed handwritten solution (get_study_item first), records the result with your feedback — it counts toward the student\'s progress, ' +
    'spaced repetition, study time and XP, and the student can re-read your feedback in the app. The photo is not stored.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    code: z.string().trim().max(20).optional().describe('e.g. "MA3-14"'),
    item_id: objectId.optional(),
    result: z.enum(['correct', 'partial', 'wrong']).describe('partial = right method but a slip, or the answer is right but the reasoning incomplete'),
    feedback: z.string().trim().min(1).max(4000).describe('Your feedback to the student in Swedish: what is right, where it first goes wrong, a hint, and what would lift it to the next level'),
    given: z.string().trim().max(500).optional().describe('The student\'s final answer as written'),
    minutes: z.number().min(0).max(120).optional().describe('How long the student worked on it, if they said')
  },
  handler: async (args, ctx) => {
    const r = await resolveItem(ctx, args, 'read');
    if (r.error) return r.error;
    const { item, unit } = r;
    const out = await recordPaperAttempt(ctx.user.id, item, unit, {
      result: args.result, feedback: args.feedback, given: args.given || '', minutes: args.minutes ?? null
    });
    return ok(`Recorded ${args.result} on ${itemCode(unit, item)} (+${out.xpEarned} XP)`, {
      code: itemCode(unit, item),
      result: args.result,
      xp_earned: out.xpEarned,
      next_review: out.state.dueAt,
      url: unitUrl(unit)
    });
  }
});

registerTool({
  name: 'resolve_study_flag',
  title: 'Close an error report',
  description:
    'Closes a "fel i facit" report on a unit you created — after fixing the item with update_study_item, or after verifying the item was right (say why in note).',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    flag_id: objectId,
    note: z.string().trim().max(500).optional().describe('What you did, e.g. "Rättade facit: x = 4"')
  },
  handler: async (args, ctx) => {
    const flag = await StudyFlag.findOneAndUpdate(
      { _id: oid(args.flag_id), owner: ctx.user.id, status: 'open' },
      { $set: { status: 'resolved', resolvedAt: new Date(), resolutionNote: args.note || '' } },
      { new: true }
    );
    if (!flag) return fail('not_found', 'No such open report on a unit the user created. list_study_flags shows the open ones.');
    return ok('Report closed', { flag_id: String(flag._id) });
  }
});

// ── mappar ───────────────────────────────────────────────────────────────────

async function folderData(folder) {
  const units = folder.unitIds.length
    ? await StudyUnit.find({ _id: { $in: folder.unitIds } }, 'code title subject term').lean()
    : [];
  const byId = new Map(units.map((u) => [String(u._id), u]));
  return {
    folder_id: folder.id,
    name: folder.name,
    color: folder.color,
    units: folder.unitIds.map((id) => byId.get(id)).filter(Boolean)
      .map((u) => ({ unit_id: String(u._id), code: u.code, title: u.title, subject: u.subject, term: u.term })),
    url: folderUrl(folder.id)
  };
}

registerTool({
  name: 'list_study_folders',
  title: 'List Mappar (folders)',
  description:
    'The student\'s own folders ("Mappar") in Plugga — groupings of units across subjects and terms, e.g. "Inför provet v. 42" — with the units in each. ' +
    'The student can practise a whole folder at once in the app.',
  scope: 'read',
  feature: FEATURE,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {},
  handler: async (args, ctx) => {
    const folders = await listFolders(ctx.user.id);
    return ok(`${folders.length} folder(s)`, await Promise.all(folders.map(folderData)));
  }
});

registerTool({
  name: 'save_study_folder',
  title: 'Create or change a Mapp (folder)',
  description:
    'Creates a folder ("Mapp") of units — e.g. everything for an upcoming test — or changes one: rename, recolour, add or remove units. ' +
    'Units can be the student\'s own or shared with them. A folder is only a selection: removing a unit from a folder never deletes the unit. ' +
    'Omit folder_id to create; pass it to change.',
  scope: 'write',
  feature: FEATURE,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    folder_id: objectId.optional().describe('Omit to create a new folder'),
    name: z.string().trim().min(1).max(60).optional().describe('Required when creating, e.g. "Inför provet v. 42"'),
    color: z.enum(COLORS).optional(),
    add_unit_ids: z.array(objectId).max(200).optional(),
    remove_unit_ids: z.array(objectId).max(200).optional()
  },
  handler: async (args, ctx) => {
    let r;
    if (!args.folder_id) {
      if (!args.name) return fail('invalid_input', 'Pass name to create a folder.');
      r = await createFolder(ctx.user.id, { name: args.name, color: args.color, unitIds: args.add_unit_ids });
    } else {
      r = await updateFolder(ctx.user.id, args.folder_id, {
        name: args.name, color: args.color, addUnitIds: args.add_unit_ids, removeUnitIds: args.remove_unit_ids
      });
    }
    if (r.error) {
      if (r.status === 404) return fail('not_found', 'No such folder. list_study_folders shows folder ids.');
      return fail(r.status === 409 ? 'conflict' : 'invalid_input', r.error);
    }
    const ignored = (args.add_unit_ids || []).filter((id) => !r.folder.unitIds.includes(id));
    const data = await folderData(r.folder);
    return ok(`${args.folder_id ? 'Updated' : 'Created'} folder "${r.folder.name}" (${r.folder.unitCount} unit(s))`, data,
      ignored.length ? { warnings: [`Not added (no such unit, or no access): ${ignored.join(', ')}. list_study_units shows valid unit ids.`] } : {});
  }
});

module.exports = { itemFull, answerIn, answerOut };
