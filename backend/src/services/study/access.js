// Åtkomst i Plugga: vilka områden får en användare läsa (egna + delade med
// en) och ändra (bara egna — innehållet ägs av skaparen). Delas av
// REST-routerna och MCP-verktygen så reglerna aldrig kan skilja sig åt.
const mongoose = require('mongoose');
const StudyUnit = require('../../models/StudyUnit');
const StudyItem = require('../../models/StudyItem');
const User = require('../../models/User');
const { parseStudyCode, formatItemCode } = require('../../utils/studyCodes');

const isId = (id) => mongoose.Types.ObjectId.isValid(String(id));
const oid = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Filter för områden användaren får läsa: egna (även arkiverade) och delade
 * med en — utom dem skaparen arkiverat, som försvinner för mottagarna.
 */
function readableFilter(userId) {
  const uid = oid(userId);
  return { $or: [{ user: uid }, { sharedWith: uid, archivedAt: null }] };
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
 * Slå upp en uppgift via koden eleven skrev på pappret ("MA3-14"). Koder är
 * unika per skapare, så en kompis MA3 kan ha samma kod som mitt eget. Finns
 * uppgiften i flera områden returneras kandidaterna (AI:n jämför med fotot och
 * frågar) — det egna vinner aldrig tyst, för då rättas fel uppgift mot fel facit.
 * `ownOnly` = bara egna områden (för att ändra innehåll).
 */
async function findItemByCode(userId, code, { ownOnly = false } = {}) {
  const parsed = parseStudyCode(code);
  if (!parsed || parsed.number === null) return { error: 'invalid_code' };
  const scope = ownOnly ? { user: oid(userId) } : readableFilter(userId);
  const units = await StudyUnit.find({ code: parsed.unitCode, ...scope });
  if (!units.length) return { error: 'not_found' };
  const items = await StudyItem.find({ unit: { $in: units.map((u) => u._id) }, number: parsed.number });
  if (!items.length) return { error: 'not_found' };
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  if (items.length > 1) {
    const owners = new Map((await User.find({ _id: { $in: units.map((u) => u.user) } }, 'username').lean())
      .map((o) => [String(o._id), o.username]));
    return {
      error: 'ambiguous',
      candidates: items.map((i) => {
        const u = unitById.get(String(i.unit));
        const own = String(u.user) === String(userId);
        return {
          item_id: String(i._id),
          unit_id: String(u._id),
          unit_title: u.title,
          is_owner: own,
          ...(own ? {} : { shared_by: owners.get(String(u.user)) || null }),
          prompt_excerpt: String(i.prompt || '').slice(0, 160)
        };
      })
    };
  }
  const unit = unitById.get(String(items[0].unit));
  return { item: items[0], unit, isOwner: String(unit.user) === String(userId) };
}

function itemCode(unit, item) {
  return formatItemCode(unit.code, item.number);
}

module.exports = { isId, oid, readableFilter, loadUnit, loadItem, findItemByCode, itemCode };
