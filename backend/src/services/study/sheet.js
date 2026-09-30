// Övningsblad: kort och övningar på papper. Samma urval som ett pass (omfång,
// läge, nivåer, antal, färdighet) men inget pass skapas och inget räknas —
// eleven löser på papper och rättar själv med facit, eller fotar bladet och
// låter sin AI rätta (get_study_item + record_paper_attempt, docs/plugga.md).
//
// En mallövning får en fast variant (ett kort frö, "MA2-7 · v482") så att
// facit gäller just de talen, och AI:n kan hämta samma instans med variant.
const { resolveScopeUnits, pickFromUnits, emptyMessage, shuffled } = require('./practice');
const { expectedAnswer, unitBrief } = require('./tests');
const { instance } = require('./templates');
const { itemCode } = require('./access');

const SHEET_MODES = ['mixed', 'cards', 'exercises', 'due', 'wrong'];
// Varianterna är korta så att de går att läsa (och skriva av) på pappret.
const MAX_VARIANT = 999;
const LEVEL_RANK = { E: 0, C: 1, A: 2 };

const letter = (i) => String.fromCharCode(65 + i);

/**
 * Facit som det står på pappret: flerval med bokstav, ordna i bokstäverna i
 * pappersordningen (`perm`: vilket alternativ som står på plats A, B, …).
 */
function facitText(answer, perm = null) {
  const a = answer || {};
  if (a.type === 'choice') return `${letter(a.correctIndex)}. ${a.choices?.[a.correctIndex] ?? ''}`;
  if (a.type === 'multi') {
    return [...(a.correctIndices || [])].sort((x, y) => x - y).map((i) => `${letter(i)}. ${a.choices?.[i] ?? ''}`).join('  ·  ');
  }
  if (a.type === 'order') {
    const choices = a.choices || [];
    const letters = choices.map((_, i) => letter(perm ? perm.indexOf(i) : i));
    return `${letters.join(' → ')} (${choices.join(' → ')})`;
  }
  if (a.type === 'self') return a.modelAnswer || '';
  return expectedAnswer({ answer: a });
}

/**
 * En uppgift som den skrivs ut — med facit. `rand` väljer mallens variant och
 * ordningen på ordna-alternativen; `variant` ger en bestämd variant.
 */
function sheetItem(item, unit, { rand = Math.random, variant = null } = {}) {
  let { prompt, solution, answer } = item;
  let hints = item.hints || [];
  let used = null;
  if (item.template) {
    try {
      const v = variant ?? 1 + Math.floor(rand() * MAX_VARIANT);
      ({ prompt, hints, solution, answer } = instance(item, v));
      used = v;
    } catch { /* trasig mall: skrivs ut som den är — rättningen säger till i appen */ }
  }
  const out = {
    id: String(item._id),
    code: itemCode(unit, item),
    ...(used ? { variant: used } : {}),
    kind: item.kind,
    level: item.level || null,
    prompt,
    hints
  };
  if (item.kind === 'card') return { ...out, facit: { answer: item.back } };
  const a = answer || {};
  out.answerType = a.type;
  if (a.type === 'choice' || a.type === 'multi') out.choices = a.choices;
  let perm = null;
  if (a.type === 'order') {
    perm = shuffled((a.choices || []).map((_, i) => i), rand);
    out.items = perm.map((i) => a.choices[i]);
  }
  if (a.type === 'number' && a.unit) out.unitLabel = a.unit;
  out.facit = { answer: facitText(a, perm), ...(solution ? { solution } : {}) };
  return out;
}

/**
 * Övningsbladet: { units, items, total } eller { error, message }. Korten
 * först, sedan övningarna från lätt till svår (E, C, A, utan nivå) — i
 * områdets och uppgifternas ordning inom varje nivå.
 */
async function practiceSheet(userId, params = {}) {
  const mode = SHEET_MODES.includes(params.mode) ? params.mode : 'mixed';
  const units = await resolveScopeUnits(userId, params);
  if (!units.length) return { error: 'not_found', message: 'Hittade inga områden att skriva ut.' };
  const { picked, total } = await pickFromUnits(userId, units, {
    mode, levels: params.levels, count: params.count, skills: params.skills
  });
  if (!picked.length) return { error: 'empty', message: emptyMessage(mode) };

  const unitOrder = new Map(units.map((u, i) => [String(u._id), i]));
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const rank = (i) => [
    i.kind === 'card' ? -1 : (LEVEL_RANK[i.level] ?? 3),
    unitOrder.get(String(i.unit)) ?? 0,
    i.number || 0
  ];
  const sorted = [...picked].sort((x, y) => {
    const a = rank(x);
    const b = rank(y);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
  const usedUnits = [...new Set(sorted.map((i) => String(i.unit)))].map((id) => unitById.get(id));
  return {
    units: usedUnits.map(unitBrief),
    items: sorted.map((i) => sheetItem(i, unitById.get(String(i.unit)))),
    total
  };
}

module.exports = { SHEET_MODES, MAX_VARIANT, practiceSheet, sheetItem, facitText };
