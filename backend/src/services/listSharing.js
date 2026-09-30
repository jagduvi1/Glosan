// Dela glos-listor — med kompisar (de får tillgång till originalet, att läsa
// eller redigera) eller via en länk (den som går med får en KOPIA av listan och
// blir kompis med skaparen — klassrummets QR-flöde). Samma regler för appen
// (routes/lists.js, routes/listInvites.js) och användarens AI (mcp/tools/sharing.js).
const mongoose = require('mongoose');
const ListInvite = require('../models/ListInvite');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { randomCode } = require('../utils/friendCode');

const INVITE_CODE_LENGTH = 8;
const MAX_ACTIVE_INVITES_PER_LIST = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Mottagarna av en lista (bara för ägaren). */
async function listShares(list) {
  return User.find({ _id: { $in: list.sharedWith } }, 'username avatar friendCode').lean();
}

/**
 * Dela med kompisar. Varje id måste vara en bekräftad kompis. `mode`
 * ('read' | 'edit', valfritt) gäller listan — alla mottagare, nya som gamla.
 * Returnerar { shares, list, added } eller { error, status }.
 */
async function shareListWithFriends(ownerId, list, friendIds, mode) {
  const validIds = (friendIds || []).map(String).filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!validIds.length) return { error: 'Inga giltiga ID:n', status: 400 };
  const friendships = await Friendship.find({ user: ownerId, friend: { $in: validIds } }, 'friend').lean();
  const confirmed = new Set(friendships.map((f) => f.friend.toString()));
  const toAdd = validIds.filter((id) => confirmed.has(id));
  if (!toAdd.length) return { error: 'Du måste vara kompis för att kunna dela listan.', status: 400 };
  const members = new Set(list.sharedWith.map(String));
  const added = toAdd.filter((id) => !members.has(id)).length;
  for (const id of toAdd) members.add(id);
  list.sharedWith = Array.from(members);
  if (mode) list.shareMode = mode;
  await list.save();
  return { shares: await listShares(list), list, added };
}

/** Ta bort en mottagare. */
async function removeListRecipient(list, userId) {
  list.sharedWith = list.sharedWith.filter((id) => id.toString() !== String(userId));
  await list.save();
  return list;
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
 * Skapa en länk (/j/<kod>) till en egen lista: 1–30 dagar, 1–1000
 * användningar, högst 3 aktiva per lista. `befriend: true` = den som går med
 * blir kompis med skaparen (bara när skaparen kryssat i det i appen).
 * Returnerar { invite } eller { error, status }.
 */
async function createListInvite(ownerId, list, { ttlDays, maxUses, befriend = false } = {}) {
  const ttl = Math.min(Math.max(Number(ttlDays) || 7, 1), 30);
  const uses = Math.min(Math.max(Number(maxUses) || 30, 1), 1000);
  const active = await ListInvite.countDocuments({ list: list._id, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (active >= MAX_ACTIVE_INVITES_PER_LIST) {
    return { error: `Du har redan ${active} aktiva invites för den här listan. Avaktivera någon först.`, status: 429 };
  }
  const invite = await ListInvite.create({
    list: list._id,
    creator: ownerId,
    code: await uniqueInviteCode(),
    expiresAt: new Date(Date.now() + ttl * DAY_MS),
    maxUses: uses,
    befriend: befriend === true
  });
  return { invite: inviteOut(invite) };
}

/** Listans länkar, nyast först. */
async function listListInvites(list) {
  const invites = await ListInvite.find({ list: list._id }).sort({ createdAt: -1 }).lean();
  return invites.map(inviteOut);
}

/** Stäng av en länk (mjukt). false = hittades inte; redan avstängd räknas som klar. */
async function revokeListInvite(ownerId, list, code) {
  const invite = await ListInvite.findOne({ code: String(code || ''), list: list._id, creator: ownerId });
  if (!invite) return false;
  if (!invite.revokedAt) {
    invite.revokedAt = new Date();
    await invite.save();
  }
  return true;
}

/** Stäng av en länk via dess id (för AI:n, som inte får se adressen till appens länkar). */
async function revokeListInviteById(ownerId, list, id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) return false;
  const invite = await ListInvite.findOne({ _id: id, list: list._id, creator: ownerId });
  if (!invite) return false;
  if (!invite.revokedAt) {
    invite.revokedAt = new Date();
    await invite.save();
  }
  return true;
}

module.exports = {
  MAX_ACTIVE_INVITES_PER_LIST,
  listShares,
  shareListWithFriends,
  removeListRecipient,
  createListInvite,
  listListInvites,
  revokeListInvite,
  revokeListInviteById
};
