// Åtkomst i Plugga: vilka områden får en användare läsa (egna + delade med
// en) och ändra (bara egna — innehållet ägs av skaparen). Delas av
// REST-routerna och MCP-verktygen så reglerna aldrig kan skilja sig åt.
const mongoose = require('mongoose');
const StudyUnit = require('../../models/StudyUnit');
const StudyItem = require('../../models/StudyItem');
const { parseStudyCode, formatItemCode } = require('../../utils/studyCodes');

const isId = (id) => mongoose.Types.ObjectId.isValid(String(id));
const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Filter för områden användaren får läsa. */
function readableFilter(userId) {
  const uid = oid(userId);
  return { $or: [{ user: uid }, { sharedWith: uid }] };
}

/**
 * Ladda ett område. level 'read' = eget eller delat, 'owner' = bara skaparen.
 * Returnerar { unit, isOwner } eller { error: 'not_found' | 'forbidden' } —
 * ett område man inte ser ser ut exakt som ett som inte finns.
 */
async function loadUnit(userId, unitId, level = 'read') {
  if (!isId(unitId)) return { error: 'not_found' };
  const unit = await StudyUnit.findOne({ _id: oid(unitId), ...readableFilter(userId) });
  if (!unit) return { error: 'not_found' };
  const isOwner = String(unit.user) === String(userId);
  if (level === 'owner' && !isOwner) return { error: 'forbidden', unit };
  return { unit, isOwner };
}

/** Ladda ett kort/en övning via id, med samma regler som loadUnit. */
async function loadItem(userId, itemId, level = 'read') {
  if (!isId(itemId)) return { error: 'not_found' };
  const item = await StudyItem.findById(itemId);
  if (!item) return { error: 'not_found' };
  const access = await loadUnit(userId, item.unit, level);
  if (access.error) return access;
  return { item, ...access };
}

/**
 * Slå upp en uppgift via koden eleven skrev på pappret ("MA3-14"). Söker i
 * egna och delade områden; finns koden i flera (ett eget MA3 och en kompis
 * MA3) vinner det egna, annars returneras kandidaterna så AI:n kan fråga.
 */
async function findItemByCode(userId, code) {
  const parsed = parseStudyCode(code);
  if (!parsed || parsed.number === null) return { error: 'invalid_code' };
  const units = await StudyUnit.find({ code: parsed.unitCode, ...readableFilter(userId) }).populate('user', 'username');
  if (!units.length) return { error: 'not_found' };
  const own = units.filter((u) => String(u.user._id) === String(userId));
  const pick = own.length === 1 ? own[0] : (units.length === 1 ? units[0] : null);
  if (!pick) {
    return {
      error: 'ambiguous',
      candidates: units.map((u) => ({ unit_id: String(u._id), title: u.title, owner: u.user.username }))
    };
  }
  const item = await StudyItem.findOne({ unit: pick._id, number: parsed.number });
  if (!item) return { error: 'not_found' };
  const unit = await StudyUnit.findById(pick._id);
  return { item, unit, isOwner: String(unit.user) === String(userId) };
}

function itemCode(unit, item) {
  return formatItemCode(unit.code, item.number);
}

module.exports = { isId, oid, readableFilter, loadUnit, loadItem, findItemByCode, itemCode };
