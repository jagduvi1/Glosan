// Blockera ett konto. Glosan är byggt för barn i skolan: vänskap kräver en
// kod, men en klasskompis kan ändå bli jobbig — trakassera via delningar,
// felrapporter till ens AI eller utmaningar. Att blockera någon:
//
//   - tar bort vänskapen, co-op-streaken och pågående utmaningar mellan bara er
//     två (gruppens utmaningar är de andras också och får vara kvar),
//   - tar bort glos-listor ni delat med varandra (även det ni delat vidare
//     till varandra) och Plugga-områden den ena följer hos den andra från före
//     kopiorna — åt båda hållen. Kopior av Plugga-områden som redan getts är
//     mottagarens och finns kvar (services/study/copies.js),
//   - hindrar att ni blir kompisar igen (kod eller länk till en lista), att
//     den andra går med i det du delar via länk (och tvärtom), och att något
//     du skrivit — ett område du skapat eller något du lagt till eller ändrat
//     i en kopia — når den andra genom någon annans delning (och tvärtom).
//
// Blockeringen syns inte för den blockerade: en kod eller länk ser bara ut att
// inte fungera. Den som blockerat kan häva det under Kompisar.
const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const CoopStreak = require('../models/CoopStreak');
const Duel = require('../models/Duel');

const MAX_BLOCKED = 500;

const isId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && /^[a-f0-9]{24}$/i.test(v);
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Har någon av de två blockerat den andra? */
async function isBlockedBetween(a, b) {
  if (!a || !b || String(a) === String(b)) return false;
  return Boolean(await User.exists({ $or: [{ _id: oid(a), blocked: oid(b) }, { _id: oid(b), blocked: oid(a) }] }));
}

/** Har `userId` själv blockerat `otherId`? (för ett begripligt fel till den som blockerat) */
async function hasBlocked(userId, otherId) {
  return Boolean(await User.exists({ _id: oid(userId), blocked: oid(otherId) }));
}

/** Blockerade konton, sorterade på namn. */
async function listBlocked(userId) {
  const me = await User.findById(userId, 'blocked').lean();
  const users = await User.find({ _id: { $in: me?.blocked || [] } }, 'username avatar').lean();
  return users
    .map((u) => ({ _id: String(u._id), username: u.username, avatar: u.avatar || null }))
    .sort((x, y) => x.username.localeCompare(y.username, 'sv'));
}

/** Blockera. Returnerar { blocked } eller { error, status }. */
async function blockUser(userId, targetId) {
  if (!isId(targetId)) return { error: 'Kontot hittades inte.', status: 404 };
  if (String(targetId) === String(userId)) return { error: 'Du kan inte blockera dig själv.', status: 400 };
  if (!(await User.exists({ _id: oid(targetId) }))) return { error: 'Kontot hittades inte.', status: 404 };
  const me = oid(userId);
  const them = oid(targetId);
  const r = await User.updateOne(
    { _id: me, blocked: { $ne: them }, [`blocked.${MAX_BLOCKED - 1}`]: { $exists: false } },
    { $addToSet: { blocked: them } }
  );
  if (!r.matchedCount && !(await hasBlocked(userId, targetId))) {
    return { error: `Du kan blockera högst ${MAX_BLOCKED} konton.`, status: 409 };
  }
  await Friendship.deleteMany({ $or: [{ user: me, friend: them }, { user: them, friend: me }] });
  await CoopStreak.deleteMany({ users: { $all: [me, them] } });
  await Duel.deleteMany({ participants: { $size: 2 }, 'participants.user': { $all: [me, them] }, 'participants.status': 'pending' });
  // Sent: delningstjänsterna behöver inte känna till blockeringar vid laddning.
  await require('./listSharing').unshareListsBetween(userId, targetId);
  await require('./study/sharing').unshareBetween(userId, targetId);
  return { blocked: await listBlocked(userId) };
}

async function unblockUser(userId, targetId) {
  if (isId(targetId)) await User.updateOne({ _id: oid(userId) }, { $pull: { blocked: oid(targetId) } });
  return { blocked: await listBlocked(userId) };
}

module.exports = { MAX_BLOCKED, isBlockedBetween, hasBlocked, listBlocked, blockUser, unblockUser };
