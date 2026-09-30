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
// En mall prövas med 30 frön när den skapas, men villkoren kan ändå sålla bort
// enstaka varianter — pröva några innan uppgiften lämnas utanför bladet.
const VARIANT_TRIES = 20;
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
 * En uppgift som den skrivs ut — med facit — eller null för en mall där ingen
 * variant gick att räkna ut (hellre borta än "{{n}}" och ett tomt facit).
 * `rand` väljer mallens variant och ordningen på ordna-alternativen; `variant`
 * ger en bestämd variant.
 */
function sheetItem(item, unit, { rand = Math.random, variant = null } = {}) {
  let { prompt, solution, answer } = item;
  let hints = item.hints || [];
  let used = null;
  if (item.template) {
    const tries = variant ? [variant] : Array.from({ length: VARIANT_TRIES }, () => 1 + Math.floor(rand() * MAX_VARIANT));
    for (const v of tries) {
      try {
        ({ prompt, hints, solution, answer } = instance(item, v));
        used = v;
        break;
      } catch { /* villkoren gick inte att uppfylla med det fröet — nästa */ }
    }
    if (!used) return null;
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
    mode, levels: params.levels, count: params.count, skills: params.skills, exclude: params.exclude
  });
  if (!picked.length) return { error: 'empty', message: emptyMessage(mode) };

  // Områdena i kodordning (MA2 före MA3 före MA10), som kapitlen på ämnessidan.
  const ordered = [...units].sort((a, b) => String(a.code).localeCompare(String(b.code), 'sv', { numeric: true }));
  const unitOrder = new Map(ordered.map((u, i) => [String(u._id), i]));
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
  const items = sorted.map((i) => sheetItem(i, unitById.get(String(i.unit)))).filter(Boolean);
  if (!items.length) return { error: 'empty', message: emptyMessage(mode) };
  const inSheet = new Set(items.map((i) => i.id));
  const usedIds = new Set(sorted.filter((i) => inSheet.has(String(i._id))).map((i) => String(i.unit)));
  return {
    units: ordered.filter((u) => usedIds.has(String(u._id))).map(unitBrief),
    items,
    total
  };
}

module.exports = { SHEET_MODES, MAX_VARIANT, practiceSheet, sheetItem, facitText };
