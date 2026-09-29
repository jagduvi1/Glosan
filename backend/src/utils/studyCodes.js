// Uppgiftskoder i Plugga: "MA3-14" = ämnesprefix (MA = matematik) +
// områdets löpnummer (3) + uppgiftens nummer i området (14). Eleven skriver
// koden överst på pappret, fotar sin lösning och ber sin AI "rätta MA3-14" —
// AI:n slår upp uppgiften via MCP. Koden måste alltså tåla handskrift: gemener,
// mellanslag och olika bindestreck ska tolkas likadant.
const { subjectByCode } = require('../config/subjects');

function formatItemCode(unitCode, number) {
  return `${unitCode}-${number}`;
}

// "MA3-14", "ma3 14", "MA 3–14", "#MA3.14", "MA3 uppg 14", "MA3" (bara området)
const CODE_RE = /^#?\s*([a-zåäö]{2})\s*(\d{1,4})(?:\s*(?:[-–—.:·/]|uppg(?:ift)?\.?)?\s*(\d{1,4}))?\s*$/i;

/**
 * Tolka en kod. Returnerar { unitCode: 'MA3', number: 14 } (number = null när
 * bara området anges), eller null om det inte är en giltig kod med ett känt
 * ämnesprefix.
 */
function parseStudyCode(input) {
  const m = CODE_RE.exec(String(input || '').trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  if (!subjectByCode(prefix)) return null;
  const unitNo = Number(m[2]);
  if (unitNo < 1) return null;
  const number = m[3] === undefined ? null : Number(m[3]);
  if (number !== null && number < 1) return null;
  return { unitCode: `${prefix}${unitNo}`, number };
}

module.exports = { formatItemCode, parseStudyCode };
