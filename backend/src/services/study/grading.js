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
  const tol = spec.tolerance > 0 ? spec.tolerance : Math.max(1e-9, Math.abs(spec.value) * 1e-9);
  const numberOk = Math.abs(parsed.value - spec.value) <= tol + 1e-12;
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
  const idx = typeof input === 'number' ? input : Number(String(input ?? '').trim());
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

/**
 * Textsvar: exakt (normaliserat) mot någon godkänd variant = rätt. Ett litet
 * stavfel i ett längre ord godtas också — men eleven får se rätt stavning.
 * Svar med siffror (årtal, datum) måste stämma exakt.
 */
function gradeText(input, spec) {
  const given = normalizeText(input);
  if (!given) return { invalid: true, message: 'Skriv ett svar först.' };
  const accepted = (spec.accepted || []).map((a) => ({ raw: a, norm: normalizeText(a) })).filter((a) => a.norm);
  const expected = accepted[0]?.raw || '';
  if (accepted.some((a) => a.norm === given)) return { result: 'correct', expected };
  for (const a of accepted) {
    if (/\d/.test(a.norm) || a.norm.length < 5) continue;
    const allowed = a.norm.length >= 10 ? 2 : 1;
    if (levenshtein(given, a.norm) <= allowed) {
      return { result: 'correct', expected, note: `Det stavas "${a.raw}".` };
    }
  }
  return { result: 'wrong', expected };
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
    default: return { invalid: true, message: 'Den här uppgiften kan inte rättas.' };
  }
}

module.exports = {
  parseNumber, formatNumber, normalizeUnit, gradeNumber, gradeChoice, gradeText, normalizeText,
  levenshtein, gradeSelf, gradeAnswer, SELF_RESULTS
};
