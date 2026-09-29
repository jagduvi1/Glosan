const mongoose = require('mongoose');
const { SUBJECT_KEYS, getSubject } = require('../config/subjects');
const { isValidTerm } = require('../utils/term');

/**
 * StudyUnit — ett "Område" i Plugga (t.ex. "Kapitel 3 — Ekvationer").
 * Skapas via MCP av användarens egen AI; appen själv har inga redigerare.
 *
 * Innehållet (StudyPage = genomgångar, StudyItem = kort/övningar) ägs av
 * skaparen (`user`). Progress ägs av VARJE användare för sig
 * (StudyItemState/StudyAttempt), så ett område kan delas med kompisar
 * (`sharedWith`) och alla övar med sin egen statistik — även de som inte har
 * någon AI. Rättningar skaparen gör når alla direkt, eftersom ingen kopia görs.
 *
 * `code` (t.ex. "MA3") är unik per ägare och aldrig återanvänd
 * (User.studyCodeCounters) — eleven skriver uppgiftskoden "MA3-14" på
 * pappret och AI:n slår upp den via MCP.
 */
const studyUnitSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subject: { type: String, enum: SUBJECT_KEYS, required: true },
  // '2026-HT' — se utils/term.js.
  term: {
    type: String,
    required: true,
    validate: { validator: isValidTerm, message: 'term must look like "2026-HT" or "2027-VT"' }
  },
  // Årskurs (grundskolan 1–9). AI:n måste fråga eleven innan den skapar något.
  gradeYear: { type: Number, min: 1, max: 9, default: null },
  code: { type: String, required: true, match: [/^[A-Z]{2}\d{1,4}$/, 'invalid unit code'] },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  // Varifrån innehållet kommer — bokens uppgifter är FÖREBILDER för AI:ns
  // egna, så eleven kan jämföra med boken.
  source: {
    book: { type: String, trim: true, maxlength: 120, default: '' },
    chapter: { type: String, trim: true, maxlength: 120, default: '' },
    pages: { type: String, trim: true, maxlength: 60, default: '' }
  },
  examDate: { type: Date, default: null },
  sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  // Löpnummer för områdets kort/övningar (MA3-1, MA3-2 …). Räknas upp
  // atomärt när uppgifter läggs till och går aldrig bakåt — en raderad
  // uppgifts nummer återanvänds inte, så en kod på ett papper pekar alltid rätt.
  itemCounter: { type: Number, default: 0, min: 0 },
  archivedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

studyUnitSchema.index({ user: 1, code: 1 }, { unique: true });
studyUnitSchema.index({ user: 1, subject: 1, term: 1 });

studyUnitSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

/**
 * Nästa lediga områdeskod för ämnet, t.ex. "MA4". Räknaren ligger på
 * användaren och räknas upp atomärt, så en kod återanvänds aldrig — inte ens
 * om det senaste området raderas (en gammal papperslösning "MA3-14" får inte
 * börja peka på en annan uppgift).
 */
studyUnitSchema.statics.nextCode = async function (userId, subjectKey) {
  const subject = getSubject(subjectKey);
  if (!subject) throw new Error(`unknown subject "${subjectKey}"`);
  const User = mongoose.model('User');
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { [`studyCodeCounters.${subject.code}`]: 1 } },
    { new: true, projection: { studyCodeCounters: 1 } }
  ).lean();
  if (!user) throw new Error('user not found');
  return `${subject.code}${user.studyCodeCounters[subject.code]}`;
};

/**
 * Reservera `count` nya uppgiftsnummer i området, atomärt. Returnerar det
 * första numret; numren är first … first + count - 1.
 */
studyUnitSchema.statics.reserveItemNumbers = async function (unitId, count) {
  const unit = await this.findByIdAndUpdate(
    unitId,
    { $inc: { itemCounter: count } },
    { new: true, projection: { itemCounter: 1 } }
  ).lean();
  if (!unit) throw new Error('unit not found');
  return unit.itemCounter - count + 1;
};

module.exports = mongoose.model('StudyUnit', studyUnitSchema);
