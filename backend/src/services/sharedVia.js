// Dela vidare — gemensamt för Plugga-områden och glos-listor. Alla som ser
// något kan dela det med sina kompisar eller via en länk. `sharedVia` på
// dokumentet säger vem som lade till vem ({ user, by }); tillgången ges av
// `sharedWith`. Skaparen ser alla (med "via …") och kan ta bort vem som helst;
// den som delat vidare ser och kan ta bort de hen själv lagt till.
const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const ownerOf = (doc) => String(doc.user?._id || doc.user);

/** Vem som delade med `userId` — skaparen om ingen rad finns (äldre delningar). */
function sharerOf(doc, userId) {
  const row = (doc.sharedVia || []).find((v) => String(v.user) === String(userId));
  return row ? String(row.by) : ownerOf(doc);
}

/** Lade `byId` till `userId`? */
function addedBy(doc, userId, byId) {
  return (doc.sharedVia || []).some((v) => String(v.user) === String(userId) && String(v.by) === String(byId));
}

/**
 * Har någon i ett par blockerat den andra? Laddar alla inblandades
 * blockeringslistor med en fråga och returnerar en kontrollfunktion.
 */
async function blockChecker(ids) {
  const unique = [...new Set(ids.map(String))];
  const people = unique.length ? await User.find({ _id: { $in: unique.map(oid) } }, 'blocked').lean() : [];
  const blocked = new Map(people.map((p) => [String(p._id), new Set((p.blocked || []).map(String))]));
  return (a, b) => Boolean(blocked.get(String(a))?.has(String(b)) || blocked.get(String(b))?.has(String(a)));
}

/** Användarnamn för en mängd id:n: Map(id → { username, avatar }). Raderade konton saknas. */
async function profiles(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique.map(oid) } }, 'username avatar').lean();
  return new Map(users.map((u) => [String(u._id), { username: u.username, avatar: u.avatar || null }]));
}

/**
 * Mottagarna som `viewerId` får se: skaparen ser alla (med `via` = den som
 * lade till personen, om det inte var skaparen själv); andra ser bara dem de
 * själva lagt till. Sorterade på namn.
 */
async function visibleRecipients(doc, viewerId) {
  const owner = ownerOf(doc);
  const isOwner = owner === String(viewerId);
  const ids = (doc.sharedWith || []).map(String).filter((id) => isOwner || sharerOf(doc, id) === String(viewerId));
  const names = await profiles([...ids, ...ids.map((id) => sharerOf(doc, id))]);
  return ids
    .filter((id) => names.has(id))
    .map((id) => {
      const by = sharerOf(doc, id);
      return {
        _id: id,
        username: names.get(id).username,
        avatar: names.get(id).avatar,
        via: isOwner && by !== owner ? names.get(by)?.username || null : null
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username, 'sv'));
}

/**
 * Vilka av `viewerId`s kompisar har redan dokumentet (skapat det, eller fått
 * det av någon)? Så Dela inte erbjuder dem. Returnerar id-strängar.
 */
async function friendsWithIt(doc, viewerId) {
  const members = [ownerOf(doc), ...(doc.sharedWith || []).map(String)].filter((id) => id !== String(viewerId));
  if (!members.length) return [];
  const rows = await Friendship.find({ user: oid(viewerId), friend: { $in: members.map(oid) } }, 'friend').lean();
  return rows.map((r) => String(r.friend));
}

/** Får `viewerId` ta bort `targetId`? Skaparen alla, andra bara dem de själva lagt till. */
function canRemove(doc, viewerId, targetId) {
  return ownerOf(doc) === String(viewerId) || addedBy(doc, targetId, viewerId);
}

/**
 * Vilka som har dokumentet `viewerId` får se tillsammans med sig själv (t.ex.
 * veckans rekord på en lista): skaparen ser alla; andra ser den som delade med
 * dem, de andra samma person delade med och dem de själva delat vidare till —
 * aldrig främlingar längre bort i kedjan, och skaparen bara om hen delade.
 * Returnerar id-strängar.
 */
function circleOf(doc, viewerId) {
  const owner = ownerOf(doc);
  const viewer = String(viewerId);
  const everyone = [owner, ...(doc.sharedWith || []).map(String)];
  if (viewer === owner) return everyone;
  const mine = sharerOf(doc, viewer);
  return everyone.filter((id) => id === viewer || id === mine
    || (id !== owner && [mine, viewer].includes(sharerOf(doc, id))));
}

module.exports = {
  oid, ownerOf, sharerOf, addedBy, blockChecker, profiles, visibleRecipients, friendsWithIt, canRemove, circleOf
};
