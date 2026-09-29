// Ämneskatalogen för Plugga — grundskolans ämnen (Lgr22). En FAST lista, inte
// fritext: då fungerar "allt NO den här terminen" som filter, varje ämne får
// ikon och färg, och Claude kan inte hitta på ett nytt ämne via MCP (nycklarna
// blir en enum i verktygens schema).
//
// `code` är prefixet i områdes- och uppgiftskoderna (MA3, MA3-14) som eleven
// skriver på pappret — två bokstäver, unika. `group` samlar NO- och
// SO-ämnena; 'no' och 'so' finns också som egna ämnen för skolor som läser
// dem integrerat. `color` är en palett-token (samma som Category.color).

const SUBJECTS = [
  { key: 'matematik', label: 'Matematik', code: 'MA', group: null, emoji: '📐', color: 'sky' },
  { key: 'fysik', label: 'Fysik', code: 'FY', group: 'no', emoji: '⚡', color: 'mustard' },
  { key: 'kemi', label: 'Kemi', code: 'KE', group: 'no', emoji: '🧪', color: 'leaf' },
  { key: 'biologi', label: 'Biologi', code: 'BI', group: 'no', emoji: '🌱', color: 'leaf' },
  { key: 'no', label: 'NO', code: 'NO', group: 'no', emoji: '🔬', color: 'leaf' },
  { key: 'historia', label: 'Historia', code: 'HI', group: 'so', emoji: '📜', color: 'coral' },
  { key: 'geografi', label: 'Geografi', code: 'GE', group: 'so', emoji: '🌍', color: 'sky' },
  { key: 'religion', label: 'Religionskunskap', code: 'RE', group: 'so', emoji: '🕊️', color: 'plum' },
  { key: 'samhallskunskap', label: 'Samhällskunskap', code: 'SH', group: 'so', emoji: '⚖️', color: 'berry' },
  { key: 'so', label: 'SO', code: 'SO', group: 'so', emoji: '🗺️', color: 'coral' },
  { key: 'teknik', label: 'Teknik', code: 'TK', group: null, emoji: '⚙️', color: 'mustard' },
  { key: 'svenska', label: 'Svenska', code: 'SV', group: null, emoji: '📖', color: 'berry' },
  { key: 'engelska', label: 'Engelska', code: 'EN', group: null, emoji: '💬', color: 'sky' },
  { key: 'moderna_sprak', label: 'Moderna språk', code: 'MS', group: null, emoji: '🗣️', color: 'plum' },
  { key: 'ovrigt', label: 'Övrigt', code: 'OV', group: null, emoji: '📦', color: 'mustard' }
];

const SUBJECT_GROUPS = {
  no: { key: 'no', label: 'NO', description: 'Biologi, fysik och kemi' },
  so: { key: 'so', label: 'SO', description: 'Geografi, historia, religionskunskap och samhällskunskap' }
};

const SUBJECT_KEYS = SUBJECTS.map((s) => s.key);
const BY_KEY = new Map(SUBJECTS.map((s) => [s.key, s]));
const BY_CODE = new Map(SUBJECTS.map((s) => [s.code, s]));

function getSubject(key) {
  return BY_KEY.get(key) || null;
}

function subjectByCode(code) {
  return BY_CODE.get(String(code || '').toUpperCase()) || null;
}

/** Ämnesnycklarna i en grupp ('no' | 'so'), t.ex. för filtret "allt NO". */
function subjectsInGroup(group) {
  return SUBJECTS.filter((s) => s.group === group).map((s) => s.key);
}

module.exports = { SUBJECTS, SUBJECT_GROUPS, SUBJECT_KEYS, getSubject, subjectByCode, subjectsInGroup };
