// Rättning i Plugga — rena funktioner, ingen AI (Glosan anropar aldrig någon
// AI i Plugga). Talsvar tolkas som en svensk elev skriver dem, textsvar
// jämförs med godkända varianter och öppna frågor/kort bedömer eleven själv.
//
// Resultat: { result: 'correct' | 'partial' | 'wrong', expected, note? }
// eller { invalid: true, message } när svaret inte gick att tolka — ett
// oläsbart svar räknas ALDRIG som fel, eleven får skriva om det.

const SELF_RESULTS = ['correct', 'partial', 'wrong'];

// ── tal ──────────────────────────────────────────────────────────────────────

function normalizeUnit(u) {
  return String(u || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\.$/, '');
}

/**
 * Tolka ett tal som en elev skriver det. Returnerar { value, unit } eller null.
 *   "3,5" "3.5" "−2" "7/2" "3 1/2" "-3 1/2" "1 000" "35 %" "12 cm" "x = 4" "≈ 3,14"
 * Kommatecken är ALLTID decimaltecken (svenska): "1,000" = 1.
 */
function parseNumber(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s || s.length > 60) return null;
  s = s.replace(/[−–—]/g, '-');           // olika minustecken
  s = s.replace(/^[a-zåäö]\s*=\s*/i, '');               // "x = 4"
  s = s.replace(/^(≈|~|ca\.?|cirka)\s*/i, '');          // ungefärliga svar
  // Tusentalsavgränsare: mellanslag (vanligt, hårt, smalt) mellan siffergrupper om tre.
  s = s.replace(/(\d)[    ](?=\d{3}(?!\d)(?!\s*\/))/g, '$1');
  const m = /^([+-])?\s*(?:(\d+)\s+(\d+)\s*\/\s*(\d+)|(\d+)\s*\/\s*(\d+)|(\d+(?:[.,]\d+)?|[.,]\d+))\s*(.*)$/.exec(s);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  let value;
  if (m[2] !== undefined) {
    const den = Number(m[4]);
    if (den === 0) return null;
    value = Number(m[2]) + Number(m[3]) / den;
  } else if (m[5] !== undefined) {
    const den = Number(m[6]);
    if (den === 0) return null;
    value = Number(m[5]) / den;
  } else {
    value = Number(m[7].replace(',', '.'));
  }
  if (!Number.isFinite(value)) return null;
  const rawRest = m[8].trim();
  // Resten måste se ut som EN enhet ("cm", "km/h", "m²", "%") — flera ord
  // ("3 eller 4") eller en ensam siffra ("3 4") betyder att det inte var ett tal.
  if (/[a-zåäö]\s+[a-zåäö0-9]/i.test(rawRest)) return null;
  const unit = normalizeUnit(rawRest);
  if (unit && (unit.length > 12 || !/^[a-zåäöµ%°][a-zåäöµ%°^/·*0-9]*$/i.test(unit))) return null;
  return { value: sign * value, unit };
}

/** Svensk visning av ett tal: 3.5 → "3,5", 0.333333333 → "0,333333". */
function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toPrecision(10));
  const str = Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(6)));
  return str.replace('.', ',').replace('-', '−');
}

function gradeNumber(input, spec) {
  const parsed = parseNumber(input);
  if (!parsed) {
    return { invalid: true, message: 'Skriv svaret som ett tal, t.ex. 3,5 eller 7/2.' };
  }
  const want = normalizeUnit(spec.unit);
  const expected = `${formatNumber(spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`;
  // Flyttalsmarginalen växer med talets storlek: 123456,75 − 123456,7 blir
  // 0,05000000000291 i datorn och ska ändå rymmas i toleransen 0,05.
  const eps = 1e-9 * Math.max(1, Math.abs(spec.value));
  const tol = spec.tolerance > 0 ? spec.tolerance : 0;
  const numberOk = Math.abs(parsed.value - spec.value) <= tol + eps;
  if (numberOk && want && parsed.unit && parsed.unit !== want) {
    return { result: 'wrong', expected, note: `Kolla enheten — svaret ska anges i ${spec.unit}.` };
  }
  if (numberOk) {
    return { result: 'correct', expected, ...(want && !parsed.unit ? { note: `Glöm inte enheten (${spec.unit}) nästa gång.` } : {}) };
  }
  return { result: 'wrong', expected };
}

// ── flerval ──────────────────────────────────────────────────────────────────

function gradeChoice(input, spec) {
  // Tomt svar är inget val — Number('') är 0 och fick annars räknas som första alternativet.
  const raw = typeof input === 'string' ? input.trim() : input;
  const idx = typeof raw === 'number' ? raw : typeof raw === 'string' && raw !== '' ? Number(raw) : NaN;
  const n = Array.isArray(spec.choices) ? spec.choices.length : 0;
  if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
    return { invalid: true, message: 'Välj ett av alternativen.' };
  }
  return { result: idx === spec.correctIndex ? 'correct' : 'wrong', expected: spec.choices[spec.correctIndex] };
}

// ── text ─────────────────────────────────────────────────────────────────────

function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLocaleLowerCase('sv')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”«»]+|[\s"'“”«».!?,;:]+$/g, '')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Ett stavfel godtas från 8 tecken, två från 12 — kortare ord blir för lätt
// ett annat ord (etanol/metanol, propan/propen).
const TYPO_MIN_1 = 8;
const TYPO_MIN_2 = 12;
// Romerska siffror ("Karl XII", "Gustav III"): en bokstav fel är en annan kung.
const ROMAN_RE = /(^|[^A-Za-zÅÄÖåäö])[IVXLCDM]{1,7}(?![A-Za-zÅÄÖåäö])/;

// Ett stavfel i början eller slutet av svaret gör ofta ett annat ord av det
// (elektron/elektrod, absorption/adsorption) — det blir "nästan", inte rätt.
// Mitt i ordet är det nästan alltid en felskrivning.
const TYPO_EDGE = 2;
const sameEdges = (a, b) => a.slice(0, TYPO_EDGE) === b.slice(0, TYPO_EDGE) && a.slice(-TYPO_EDGE) === b.slice(-TYPO_EDGE);

/**
 * Textsvar: exakt (normaliserat) mot någon godkänd variant = rätt. Ett litet
 * stavfel mitt i ett längre ord godtas också — men eleven får se rätt
 * stavning. Rör stavfelet de två första eller sista bokstäverna blir det
 * "nästan". Svar med siffror (årtal, datum) eller romerska siffror måste
 * stämma exakt, liksom allt i en uppgift med `exact`.
 */
function gradeText(input, spec) {
  const given = normalizeText(input);
  if (!given) return { invalid: true, message: 'Skriv ett svar först.' };
  const accepted = (spec.accepted || []).map((a) => ({ raw: a, norm: normalizeText(a) })).filter((a) => a.norm);
  const expected = accepted[0]?.raw || '';
  if (accepted.some((a) => a.norm === given)) return { result: 'correct', expected };
  if (spec.exact) return { result: 'wrong', expected };
  let nearEdge = null;
  for (const a of accepted) {
    if (/\d/.test(a.norm) || ROMAN_RE.test(a.raw) || a.norm.length < TYPO_MIN_1) continue;
    const allowed = a.norm.length >= TYPO_MIN_2 ? 2 : 1;
    if (levenshtein(given, a.norm) <= allowed) {
      if (sameEdges(given, a.norm)) return { result: 'correct', expected, note: `Det stavas "${a.raw}".` };
      nearEdge = nearEdge || a;
    }
  }
  if (nearEdge) {
    return { result: 'partial', expected, note: `Nästan — det heter "${nearEdge.raw}". Kolla början och slutet: där kan en bokstav göra det till ett annat ord.` };
  }
  return { result: 'wrong', expected };
}

// ── flerval med flera rätta ──────────────────────────────────────────────────

/**
 * Alla rätta och inga fel = rätt. Bara rätta men några saknas = nästan.
 * Minst ett fel val = fel (annars lönar det sig att kryssa allt).
 */
function gradeMulti(input, spec) {
  const n = Array.isArray(spec.choices) ? spec.choices.length : 0;
  const picked = Array.isArray(input) ? input.map(Number) : null;
  if (!picked || picked.length === 0) return { invalid: true, message: 'Välj minst ett alternativ.' };
  if (picked.some((i) => !Number.isInteger(i) || i < 0 || i >= n) || new Set(picked).size !== picked.length) {
    return { invalid: true, message: 'Välj bland alternativen.' };
  }
  const right = new Set(spec.correctIndices || []);
  const expected = (spec.correctIndices || []).map((i) => spec.choices[i]).join(', ');
  const hits = picked.filter((i) => right.has(i)).length;
  const misses = picked.length - hits;
  if (misses === 0 && hits === right.size) return { result: 'correct', expected };
  if (misses === 0) {
    const left = right.size - hits;
    return { result: 'partial', expected, note: `Allt du valde stämmer — men ${left} alternativ till är rätt.` };
  }
  return { result: 'wrong', expected };
}

// ── ordna ────────────────────────────────────────────────────────────────────

/** `input`: alternativen i elevens ordning (texterna). Rätt ordning = rätt. */
function gradeOrder(input, spec) {
  const want = (spec.choices || []).map(normalizeText);
  const got = Array.isArray(input) ? input.map(normalizeText) : null;
  const sameSet = got && got.length === want.length && [...got].sort().join('\u0000') === [...want].sort().join('\u0000');
  if (!sameSet) return { invalid: true, message: 'Ordna alla alternativen.' };
  const expected = spec.choices.join(' → ');
  return { result: got.every((g, i) => g === want[i]) ? 'correct' : 'wrong', expected };
}

// ── faktorer ─────────────────────────────────────────────────────────────────

const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/**
 * Faktorer som en elev skriver dem: "2·3·3·5", "3*2*5*3", "2 3 3 5",
 * "2·3²·5", "2 · 3^2 · 5", "90 = 2·3·3·5". Returnerar talen eller null.
 */
function parseFactors(input) {
  let s = String(input ?? '').trim();
  if (!s || s.length > 120) return null;
  if (s.includes('=')) s = s.slice(s.lastIndexOf('=') + 1);
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${[...m].map((c) => SUPERSCRIPT[c]).join('')}`)
    .replace(/\s*\^\s*/g, '^')
    .trim();
  const parts = s.split(/\s*[·⋅•*×xX]\s*|\s+/).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    const m = /^(\d{1,10})(?:\^(\d{1,2}))?$/.exec(p);
    if (!m) return null;
    const base = Number(m[1]);
    const exp = m[2] ? Number(m[2]) : 1;
    if (base < 2 || exp < 1) return null;
    for (let i = 0; i < exp; i++) out.push(base);
    if (out.length > 60) return null;
  }
  return out;
}

const formatFactors = (list) => [...list].sort((a, b) => a - b).join(' · ');

/** Samma faktorer i valfri ordning = rätt. Rätt produkt med andra faktorer = nästan. */
function gradeFactors(input, spec) {
  const got = parseFactors(input);
  if (!got) return { invalid: true, message: 'Skriv faktorerna med · eller * emellan, t.ex. 2·3·3·5 (3² eller 3^2 går också).' };
  const want = [...(spec.factors || [])].sort((a, b) => a - b);
  const expected = formatFactors(want);
  const g = [...got].sort((a, b) => a - b);
  if (g.length === want.length && g.every((x, i) => x === want[i])) return { result: 'correct', expected };
  const product = (arr) => arr.reduce((p, x) => p * x, 1);
  if (product(g) === product(want)) {
    return { result: 'partial', expected, note: 'Produkten stämmer, men det är inte de faktorer som söks — dela upp dem mer.' };
  }
  return { result: 'wrong', expected };
}

/** Elevens svar som text, för historiken ("svar: 23, 29"). */
function describeAnswer(item, answer) {
  const a = item.answer || {};
  if (a.type === 'choice') return a.choices?.[Number(answer)] ?? String(answer ?? '');
  if (a.type === 'multi' && Array.isArray(answer)) return answer.map((i) => a.choices?.[Number(i)]).filter(Boolean).join(', ');
  if (a.type === 'order' && Array.isArray(answer)) return answer.join(' → ');
  return String(answer ?? '');
}

// ── självbedömning (kort och öppna frågor) ───────────────────────────────────

function gradeSelf(self) {
  if (!SELF_RESULTS.includes(self)) {
    return { invalid: true, message: 'Bedöm ditt svar: kunde, nästan eller inte än.' };
  }
  return { result: self };
}

/**
 * Rätta ett svar på ett StudyItem. `payload`: { answer } för automatiskt
 * rättade typer, { self } för kort och öppna frågor.
 */
function gradeAnswer(item, payload = {}) {
  if (item.kind === 'card') return { ...gradeSelf(payload.self), expected: item.back };
  const spec = item.answer || {};
  switch (spec.type) {
    case 'number': return gradeNumber(payload.answer, spec);
    case 'choice': return gradeChoice(payload.answer, spec);
    case 'text': return gradeText(payload.answer, spec);
    case 'self': return { ...gradeSelf(payload.self), expected: spec.modelAnswer };
    case 'multi': return gradeMulti(payload.answer, spec);
    case 'order': return gradeOrder(payload.answer, spec);
    case 'factors': return gradeFactors(payload.answer, spec);
    default: return { invalid: true, message: 'Den här uppgiften kan inte rättas.' };
  }
}

module.exports = {
  parseNumber, formatNumber, normalizeUnit, gradeNumber, gradeChoice, gradeText, normalizeText,
  levenshtein, gradeSelf, gradeMulti, gradeOrder, parseFactors, formatFactors, gradeFactors, describeAnswer,
  gradeAnswer, SELF_RESULTS
};
