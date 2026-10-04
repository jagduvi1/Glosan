const mongoose = require('mongoose');
const { SUBJECT_KEYS, getSubject } = require('../config/subjects');
const { isValidTerm } = require('../utils/term');

/**
 * StudyUnit — ett "Område" i Plugga (t.ex. "Kapitel 3 — Ekvationer").
 * Skapas via MCP av användarens egen AI; appen själv har inga redigerare.
 *
 * Innehållet (StudyPage = genomgångar, StudyItem = kort/övningar) ägs av
 * skaparen (`user`). Progress ägs av VARJE användare för sig
 * (StudyItemState/StudyAttempt). Den som får ett område delat får sedan
 * v0.1.38 en egen KOPIA (`copiedFrom`, services/study/copies.js) — även den
 * som inte har någon AI kan plugga på den. De som delades med tidigare följer
 * originalet (`sharedWith`) och ser skaparens rättningar direkt.
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
  // Vem som lade till vem i sharedWith (v0.1.37). Sedan v0.1.38 ger en delning
  // en KOPIA i stället (copiedFrom nedan); sharedWith/sharedVia finns kvar för
  // dem som redan följde ett original. Saknas raden har skaparen delat.
  sharedVia: [{
    _id: false,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  }],
  // En kopia som någon delat (services/study/copies.js):
  //   unit   — området den först kopierades från
  //   root   — originalet först i kedjan av kopior: man har högst EN kopia
  //            per original, hur många vägar det än kommer
  //   by     — den som först gav kopian ("från X")
  //   origin — den som skapade originalet (för blockeringar längs kedjan)
  //   givers — alla som delat det med ägaren (deras "har fått en kopia av dig")
  //   editors — de som ändrat titel, beskrivning eller källa längs vägen
  //             (för blockeringar: det de skrivit når inte den som blockerat dem)
  copiedFrom: {
    type: new mongoose.Schema({
      unit: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true },
      root: { type: mongoose.Schema.Types.ObjectId, ref: 'StudyUnit', required: true },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      origin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      givers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
      editors: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: undefined },
      at: { type: Date, default: Date.now }
    }, { _id: false }),
    default: undefined
  },
  // Det ägaren tagit bort ur sin kopia (originalens id för sidor, uppgifter
  // och prov) — så att en ny delning aldrig lägger tillbaka det. Glöms aldrig,
  // till skillnad från borttagningsloggen som gallras.
  copyDropped: { type: [{ type: mongoose.Schema.Types.ObjectId }], default: undefined },
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
// Har mottagaren redan en kopia av originalet? Och: vilka har fått en kopia av mig?
studyUnitSchema.index({ user: 1, 'copiedFrom.root': 1 });
studyUnitSchema.index({ 'copiedFrom.root': 1, 'copiedFrom.givers': 1 });

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
