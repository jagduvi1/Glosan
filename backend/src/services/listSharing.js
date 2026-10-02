// Dela glos-listor — med kompisar (de får tillgång till originalet, att läsa
// eller redigera) eller via en länk (den som går med får en KOPIA av listan, och
// blir kompis med den som gjort länken bara om hen kryssat i det i appen).
// Samma regler för appen (routes/lists.js, routes/listInvites.js) och
// användarens AI (mcp/tools/sharing.js).
//
// Alla som har en lista kan dela den vidare (services/sharedVia.js): med sina
// kompisar eller med en egen länk. Ägaren ser alla som har listan ("via …")
// och kan ta bort vem som helst; den som delat vidare ser bara dem hen själv
// lagt till. Ändra glosor får bara de ägaren själv delat med (när listan är
// 'edit') — den som fått listan vidare av någon annan får läsa och öva.
// Har ägaren och mottagaren blockerat varandra kommer listan aldrig fram.
const mongoose = require('mongoose');
const GlosList = require('../models/GlosList');
const ListInvite = require('../models/ListInvite');
const Friendship = require('../models/Friendship');
const { randomCode } = require('../utils/friendCode');
const { oid, ownerOf, sharerOf, blockChecker, profiles, visibleRecipients } = require('./sharedVia');

const INVITE_CODE_LENGTH = 8;
const MAX_ACTIVE_INVITES_PER_LIST = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const isId = (id) => mongoose.Types.ObjectId.isValid(String(id));

/** Har `userId` listan — äger den eller har fått den delad? */
function hasList(list, userId) {
  return ownerOf(list) === String(userId) || (list.sharedWith || []).some((id) => String(id) === String(userId));
}

/**
 * Får `userId` ändra glosorna? Ägaren alltid. En mottagare bara när listan
 * är 'edit' och det var ägaren som delade med hen — den som fått listan
 * vidare av någon annan har ägaren aldrig valt.
 */
function canEditWords(list, userId) {
  if (ownerOf(list) === String(userId)) return true;
  return list.shareMode === 'edit' && hasList(list, userId) && sharerOf(list, userId) === ownerOf(list);
}

/**
 * Listan som `userId` får se. Mottagare ser inte vem som äger den (bara den
 * som delade med dem, i `sharedBy`) eller vilka andra som har den — bara
 * ägaren gör det — och får sitt eget läge: 'edit' bara om hen får ändra.
 */
function listForViewer(list, userId) {
  const l = typeof list.toObject === 'function' ? list.toObject() : { ...list };
  if (ownerOf(l) === String(userId)) return l;
  delete l.user;
  delete l.sharedWith;
  delete l.sharedVia;
  l.shareMode = canEditWords(list, userId) ? 'edit' : 'read';
  return l;
}

/**
 * Vilka har listan? Ägaren ser alla (med `via` för dem någon annan lagt
 * till); den som delat vidare ser bara dem hen själv lagt till.
 */
async function listShares(list, viewerId = ownerOf(list)) {
  return visibleRecipients(list, viewerId);
}

/**
 * Dela med kompisar. Varje id måste vara en bekräftad kompis till den som
 * delar. Den som redan har listan, är ägaren eller har blockerat ägaren (eller
 * blockerats av hen) hoppas tyst över. `mode` ('read' | 'edit', bara ägaren)
 * gäller listan — alla ägaren delat med, nya som gamla.
 * Returnerar { shares, list, added } eller { error, status }.
 */
async function shareListWithFriends(sharerId, list, friendIds, mode) {
  const validIds = [...new Set((friendIds || []).map(String).filter(isId))];
  if (!validIds.length) return { error: 'Inga giltiga ID:n', status: 400 };
  const friendships = await Friendship.find({ user: sharerId, friend: { $in: validIds } }, 'friend').lean();
  const confirmed = friendships.map((f) => f.friend.toString());
  if (!confirmed.length) return { error: 'Du måste vara kompis för att kunna dela listan.', status: 400 };
  const owner = ownerOf(list);
  const blocked = await blockChecker([owner, ...confirmed]);
  const adds = confirmed.filter((id) => id !== owner && !hasList(list, id) && !blocked(owner, id));
  // En uppdatering per mottagare, bara om hen inte redan har listan: delar två
  // med samma person samtidigt vinner den första (annars kunde personen räknas
  // som "via" fel person och tappa ändringsrätten ägaren gav).
  const ops = adds.map((id) => ({
    updateOne: {
      filter: { _id: list._id, sharedWith: { $ne: oid(id) } },
      update: {
        $addToSet: { sharedWith: oid(id) },
        // Ägarens egna delningar behöver ingen rad (saknad rad = ägaren delade).
        ...(owner === String(sharerId) ? {} : { $push: { sharedVia: { user: oid(id), by: oid(sharerId) } } })
      }
    }
  }));
  const added = ops.length ? (await GlosList.bulkWrite(ops, { ordered: false })).modifiedCount : 0;
  if (mode && owner === String(sharerId)) {
    await GlosList.updateOne({ _id: list._id }, { $set: { shareMode: mode, updatedAt: new Date() } });
  }
  const fresh = (await GlosList.findById(list._id)) || list;
  return { shares: await listShares(fresh, sharerId), list: fresh, added };
}

/** Stäng av (eller ta bort ur) länkar `creatorId` gjort till listan — hen har inte listan längre. */
async function revokeInvitesBy(listId, creatorId) {
  await ListInvite.updateMany({ list: listId, creator: oid(creatorId), revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/** Ta bort en mottagare — och stäng hens länkar till listan. Returnerar listan (uppdaterad). */
async function removeListRecipient(list, userId) {
  if (!isId(userId)) return list;
  const fresh = await GlosList.findOneAndUpdate(
    { _id: list._id },
    { $pull: { sharedWith: oid(userId), sharedVia: { user: oid(userId) } } },
    { new: true }
  );
  await revokeInvitesBy(list._id, userId);
  return fresh || list;
}

/**
 * Två personer slutar dela med varandra (blockering): inga listor åt något
 * håll — varken den enas egna eller det den ena delat vidare till den andra.
 */
async function unshareListsBetween(a, b) {
  if (!isId(a) || !isId(b)) return;
  for (const [giver, recipient] of [[oid(a), oid(b)], [oid(b), oid(a)]]) {
    // eslint-disable-next-line no-await-in-loop
    const lists = await GlosList.find({
      sharedWith: recipient,
      $or: [{ user: giver }, { sharedVia: { $elemMatch: { user: recipient, by: giver } } }]
    }, '_id').lean();
    for (const l of lists) await removeListRecipient(l, recipient); // eslint-disable-line no-await-in-loop
  }
}

async function uniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(INVITE_CODE_LENGTH);
    // eslint-disable-next-line no-await-in-loop
    const exists = await ListInvite.findOne({ code }).select('_id').lean();
    if (!exists) return code;
  }
  throw new Error('Kunde inte generera unik invite-kod');
}

function inviteOut(i) {
  return {
    _id: i._id,
    code: i.code,
    expiresAt: i.expiresAt,
    maxUses: i.maxUses,
    usedCount: (i.usedBy || []).length,
    revoked: Boolean(i.revokedAt),
    befriend: i.befriend !== false,
    createdAt: i.createdAt
  };
}

/**
 * Skapa en länk (/j/<kod>) till en lista man har (egen eller delad med en):
 * 1–30 dagar, 1–1000 användningar, högst 3 aktiva per person och lista.
 * `befriend: true` = den som går med blir kompis med den som gjort länken
 * (bara när hen kryssat i det i appen). Returnerar { invite } eller { error, status }.
 */
async function createListInvite(creatorId, list, { ttlDays, maxUses, befriend = false } = {}) {
  const ttl = Math.min(Math.max(Number(ttlDays) || 7, 1), 30);
  const uses = Math.min(Math.max(Number(maxUses) || 30, 1), 1000);
  const active = await ListInvite.countDocuments({
    list: list._id, creator: oid(creatorId), revokedAt: null, expiresAt: { $gt: new Date() }
  });
  if (active >= MAX_ACTIVE_INVITES_PER_LIST) {
    return { error: `Du har redan ${active} aktiva invites för den här listan. Avaktivera någon först.`, status: 429 };
  }
  const invite = await ListInvite.create({
    list: list._id,
    creator: creatorId,
    code: await uniqueInviteCode(),
    expiresAt: new Date(Date.now() + ttl * DAY_MS),
    maxUses: uses,
    befriend: befriend === true
  });
  return { invite: inviteOut(invite) };
}

/**
 * Listans länkar, nyast först: ens egna (även avstängda och utgångna, som
 * appen visar som historik) och — för ägaren — andras länkar som fortfarande
 * går att använda, med `via`, så länge de har listan kvar. Andras länkar
 * lämnas ut med id, aldrig med koden: ägaren ska kunna stänga dem, inte
 * använda eller sprida dem (en länk kan göra den som går med till kompis med
 * den som gjort den).
 */
async function listListInvites(list, viewerId = ownerOf(list)) {
  const owner = ownerOf(list);
  const viewer = String(viewerId);
  const [ownActive, ownHistory, others] = await Promise.all([
    // De aktiva (högst 3 per person och lista) kommer alltid med, hur lång historiken än är.
    ListInvite.find({ list: list._id, creator: oid(viewer), revokedAt: null, expiresAt: { $gt: new Date() } }).lean(),
    ListInvite.find({ list: list._id, creator: oid(viewer) }).sort({ createdAt: -1 }).limit(30).lean(),
    owner === viewer
      ? ListInvite.find({
        list: list._id,
        creator: { $ne: oid(viewer) },
        revokedAt: null,
        expiresAt: { $gt: new Date() },
        $expr: { $lt: [{ $size: '$usedBy' }, '$maxUses'] }
      }).sort({ createdAt: -1 }).limit(100).lean()
      : []
  ]);
  const live = others.filter((i) => hasList(list, i.creator));
  const names = await profiles(live.map((i) => i.creator));
  const own = [...new Map([...ownActive, ...ownHistory].map((i) => [String(i._id), i])).values()];
  return [
    ...own.map((i) => ({ ...inviteOut(i), via: null })),
    ...live.map((i) => {
      const { code, ...out } = inviteOut(i); // eslint-disable-line no-unused-vars
      return { ...out, via: names.get(String(i.creator))?.username || 'ett raderat konto' };
    })
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Filter för länkar `viewerId` får stänga: sina egna, och ägaren alla till listan. */
function closableBy(list, viewerId) {
  return ownerOf(list) === String(viewerId) ? { list: list._id } : { list: list._id, creator: oid(viewerId) };
}

async function revoke(invite) {
  if (!invite) return false;
  if (!invite.revokedAt) {
    invite.revokedAt = new Date();
    await invite.save();
  }
  return true;
}

/** Stäng av en länk (mjukt). false = hittades inte; redan avstängd räknas som klar. */
async function revokeListInvite(viewerId, list, code) {
  return revoke(await ListInvite.findOne({ code: String(code || ''), ...closableBy(list, viewerId) }));
}

/** Stäng av en länk via dess id (för AI:n, som inte får se adressen till appens länkar). */
async function revokeListInviteById(viewerId, list, id) {
  if (!isId(id)) return false;
  return revoke(await ListInvite.findOne({ _id: id, ...closableBy(list, viewerId) }));
}

/**
 * En länk gäller bara så länge den som gjort den har listan kvar — och aldrig
 * för den som har blockerat listans ägare (eller blockerats av hen).
 * Returnerar listan eller null.
 */
async function inviteList(invite, joinerId = null) {
  const list = await GlosList.findById(invite.list);
  if (!list || !hasList(list, invite.creator)) return null;
  if (joinerId && String(joinerId) !== ownerOf(list)) {
    const blocked = await blockChecker([ownerOf(list), String(joinerId)]);
    if (blocked(ownerOf(list), joinerId)) return null;
  }
  return list;
}

module.exports = {
  MAX_ACTIVE_INVITES_PER_LIST,
  hasList,
  canEditWords,
  listForViewer,
  listShares,
  shareListWithFriends,
  removeListRecipient,
  unshareListsBetween,
  createListInvite,
  listListInvites,
  revokeListInvite,
  revokeListInviteById,
  inviteList
};
