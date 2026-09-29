// Terminer ("HT 2026", "VT 2027") för Plugga. Lagras som sorterbar nyckel
// '2026-HT'. Skolåret: vårterminen januari–juni, hösttermin juli–december
// (sommarlovet räknas till den kommande höstterminen, så det man skapar i
// juli hamnar rätt).

const TERM_RE = /^(20\d{2})-(HT|VT)$/;

/** Terminen ett datum hör till, t.ex. '2026-HT'. */
function termFor(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth() >= 6 ? 'HT' : 'VT'}`;
}

function isValidTerm(key) {
  return typeof key === 'string' && TERM_RE.test(key);
}

/** '2026-HT' → 'HT 2026' (så som skolan skriver det). */
function termLabel(key) {
  const m = TERM_RE.exec(key || '');
  return m ? `${m[2]} ${m[1]}` : String(key || '');
}

/** Sorteringsordning: år, och VT före HT samma år. */
function termOrdinal(key) {
  const m = TERM_RE.exec(key || '');
  return m ? Number(m[1]) * 2 + (m[2] === 'HT' ? 1 : 0) : -1;
}

function compareTerms(a, b) {
  return termOrdinal(a) - termOrdinal(b);
}

function shiftTerm(key, steps) {
  const ord = termOrdinal(key) + steps;
  return `${Math.floor(ord / 2)}-${ord % 2 === 1 ? 'HT' : 'VT'}`;
}

module.exports = { termFor, isValidTerm, termLabel, termOrdinal, compareTerms, shiftTerm };
