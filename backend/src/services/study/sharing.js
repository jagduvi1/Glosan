// Dela områden i Plugga — med kompisar eller via en länk/QR-kod. Den som får
// ett område delat får ingen kopia: hen läggs till i `sharedWith`, övar med
// sin egen progress och ser skaparens rättningar direkt. Bara skaparen (och
// skaparens AI) kan ändra innehållet. Poängen är att även den som INTE har
// någon AI kan plugga på det en kompis har skapat.
const StudyUnit = require('../../models/StudyUnit');
const StudyPage = require('../../models/StudyPage');
const StudyItem = require('../../models/StudyItem');
const StudyShareLink = require('../../models/StudyShareLink');
const StudyFolder = require('../../models/StudyFolder');
const StudyFlag = require('../../models/StudyFlag');
const User = require('../../models/User');
const Friendship = require('../../models/Friendship');
const { getSubject } = require('../../config/subjects');
const { termLabel } = require('../../utils/term');
const { randomCode } = require('../../utils/friendCode');
const { isId, oid } = require('./access');

const MAX_RECIPIENTS = 300;
const MAX_ACTIVE_LINKS_PER_UNIT = 3;
const LINK_CODE_LENGTH = 8;
const LINK_TTL_DAYS = [1, 7, 30];
const LINK_MAX_USES = [10, 30, 100];

const LINK_GONE = 'Den här länken är ogiltig eller har gått ut.';

/**
 * Inbjudningsbeta: den som får ett område delat får Plugga påslaget, annars
 * skulle hen inte se det hen fått. Modulen sprids alltså bara till dem som
 * någon med Plugga bjuder in. Har admin slagit av Plugga för ett konto
 * (featureBlocks) slås den inte på igen.
 */
async function grantStudyFeature(userIds) {
  if (!userIds.length) return;
  await User.updateMany({ _id: { $in: userIds.map(oid) }, featureBlocks: { $ne: 'study' } }, { $addToSet: { features: 'study' } });
}

/** Vilka har området delat med sig? (bara för skaparen) */
async function listRecipients(unit) {
  const users = await User.find({ _id: { $in: unit.sharedWith || [] } }, 'username avatar').lean();
  return users
    .map((u) => ({ _id: String(u._id), username: u.username, avatar: u.avatar || null }))
    .sort((a, b) => a.username.localeCompare(b.username, 'sv'));
}

/**
 * Dela med kompisar. Bara bekräftade kompisar räknas (samma regel som för
 * glos-listor). Returnerar { recipients } eller { error, status }.
 */
async function shareWithFriends(ownerId, unit, friendIds) {
  const ids = [...new Set((friendIds || []).map(String).filter(isId))].filter((id) => id !== String(ownerId));
  if (!ids.length) return { error: 'Välj minst en kompis.', status: 400 };
  const friendships = await Friendship.find({ user: ownerId, friend: { $in: ids.map(oid) } }, 'friend').lean();
  const confirmed = friendships.map((f) => String(f.friend));
  if (!confirmed.length) return { error: 'Du kan bara dela med dina kompisar.', status: 400 };
  const already = new Set((unit.sharedWith || []).map(String));
  const toAdd = confirmed.filter((id) => !already.has(id));
  if (already.size + toAdd.length > MAX_RECIPIENTS) {
    return { error: `Ett område kan delas med högst ${MAX_RECIPIENTS} personer.`, status: 409 };
  }
  if (toAdd.length) {
    await StudyUnit.updateOne({ _id: unit._id }, { $addToSet: { sharedWith: { $each: toAdd.map(oid) } } });
    await grantStudyFeature(toAdd);
  }
  const fresh = await StudyUnit.findById(unit._id, 'sharedWith').lean();
  return { recipients: await listRecipients(fresh), added: toAdd.length };
}

/** Ta bort någon ur delningen — och området ur hens mappar och hens öppna felrapporter. */
async function removeRecipient(unit, userId) {
  if (!isId(userId)) return;
  await StudyUnit.updateOne({ _id: unit._id }, { $pull: { sharedWith: oid(userId) } });
  await StudyFolder.updateMany({ user: oid(userId), units: unit._id }, { $pull: { units: unit._id } });
  await StudyFlag.deleteMany({ unit: unit._id, reporter: oid(userId), status: 'open' });
}

// ── länkar / QR ──────────────────────────────────────────────────────────────

async function uniqueLinkCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(LINK_CODE_LENGTH);
    // eslint-disable-next-line no-await-in-loop
    if (!(await StudyShareLink.exists({ code }))) return code;
  }
  throw new Error('Could not generate a unique share code');
}

function linkOut(l) {
  return {
    code: l.code,
    expiresAt: l.expiresAt,
    maxUses: l.maxUses,
    usedCount: (l.usedBy || []).length,
    revoked: Boolean(l.revokedAt),
    createdAt: l.createdAt
  };
}

async function createShareLink(ownerId, unit, { ttlDays, maxUses } = {}) {
  const ttl = LINK_TTL_DAYS.includes(Number(ttlDays)) ? Number(ttlDays) : 7;
  const uses = LINK_MAX_USES.includes(Number(maxUses)) ? Number(maxUses) : 30;
  const now = new Date();
  const active = await StudyShareLink.countDocuments({ unit: unit._id, revokedAt: null, expiresAt: { $gt: now } });
  if (active >= MAX_ACTIVE_LINKS_PER_UNIT) {
    return { error: `Du har redan ${active} aktiva länkar för området — stäng av någon först.`, status: 429 };
  }
  const link = await StudyShareLink.create({
    unit: unit._id,
    creator: ownerId,
    code: await uniqueLinkCode(),
    expiresAt: new Date(now.getTime() + ttl * 24 * 60 * 60 * 1000),
    maxUses: uses
  });
  return { link: linkOut(link) };
}

async function listShareLinks(unit) {
  const links = await StudyShareLink.find({ unit: unit._id }).sort({ createdAt: -1 }).limit(20).lean();
  return links.map(linkOut);
}

async function revokeShareLink(unit, code) {
  const r = await StudyShareLink.updateOne(
    { unit: unit._id, code: String(code || ''), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return r.matchedCount > 0;
}

async function loadActiveLink(code) {
  if (typeof code !== 'string' || !/^[A-Z0-9]{4,16}$/.test(code)) return null;
  const link = await StudyShareLink.findOne({ code });
  return link && link.isActive() ? link : null;
}

/**
 * Publik förhandsvisning av en länk (ingen inloggning). null = ogiltig.
 * Bara det som behövs för att känna igen området — inte årskurs, bok eller
 * beskrivning, som säger mer om skaparen (ofta ett barn) än om innehållet.
 */
async function previewInvite(code) {
  const link = await loadActiveLink(code);
  if (!link) return null;
  const [unit, creator] = await Promise.all([
    StudyUnit.findOne({ _id: link.unit, archivedAt: null }).lean(),
    User.findById(link.creator, 'username avatar').lean()
  ]);
  if (!unit || !creator) return null;
  const [pages, kinds] = await Promise.all([
    StudyPage.countDocuments({ unit: unit._id }),
    StudyItem.aggregate([
      { $match: { unit: unit._id, usage: 'practice' } },
      { $group: { _id: '$kind', n: { $sum: 1 } } }
    ])
  ]);
  const count = (k) => kinds.find((r) => r._id === k)?.n || 0;
  const subject = getSubject(unit.subject);
  return {
    unit: {
      code: unit.code,
      title: unit.title,
      subject: unit.subject,
      subjectLabel: subject?.label || unit.subject,
      emoji: subject?.emoji || '',
      termLabel: termLabel(unit.term),
      pages,
      cards: count('card'),
      exercises: count('exercise')
    },
    creator: { username: creator.username, avatar: creator.avatar || null },
    expiresAt: link.expiresAt,
    remainingUses: link.maxUses - link.usedBy.length
  };
}

/**
 * Gå med i ett delat område via länk. Idempotent: den som redan är med (eller
 * äger området) skickas bara vidare, utan att förbruka en plats på länken.
 * Man blir INTE kompis med skaparen — en länk kan ha spridits vidare, och
 * kompisar ser varandras streak och kan dela och utmana.
 * Returnerar { unitId, joined } eller { error, status }.
 */
async function acceptInvite(userId, code) {
  const link = await loadActiveLink(code);
  if (!link) return { error: LINK_GONE, status: 404 };
  // En åtkomsttoken lever 15 min efter att kontot raderats — inga spökmedlemmar.
  if (!(await User.exists({ _id: oid(userId) }))) return { error: 'Logga in igen.', status: 401 };
  const unit = await StudyUnit.findOne({ _id: link.unit, archivedAt: null }, 'user sharedWith').lean();
  if (!unit) return { error: 'Området finns inte längre.', status: 404 };
  const uid = oid(userId);
  if (String(unit.user) === String(userId)) return { unitId: String(unit._id), joined: false, own: true };
  if ((unit.sharedWith || []).some((id) => String(id) === String(userId))) {
    await grantStudyFeature([userId]);
    return { unitId: String(unit._id), joined: false };
  }
  if ((unit.sharedWith || []).length >= MAX_RECIPIENTS) {
    return { error: `Området är redan delat med ${MAX_RECIPIENTS} personer.`, status: 409 };
  }
  // Förbruka en plats atomärt, så två samtidiga klick aldrig spräcker maxUses.
  const claimed = await StudyShareLink.findOneAndUpdate(
    {
      _id: link._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
      usedBy: { $ne: uid },
      $expr: { $lt: [{ $size: '$usedBy' }, '$maxUses'] }
    },
    { $push: { usedBy: uid } },
    { new: true }
  );
  if (!claimed) return { error: LINK_GONE, status: 404 };
  await StudyUnit.updateOne({ _id: unit._id }, { $addToSet: { sharedWith: uid } });
  await grantStudyFeature([userId]);
  return { unitId: String(unit._id), joined: true };
}

module.exports = {
  MAX_RECIPIENTS,
  LINK_TTL_DAYS,
  LINK_MAX_USES,
  grantStudyFeature,
  listRecipients,
  shareWithFriends,
  removeRecipient,
  createShareLink,
  listShareLinks,
  revokeShareLink,
  previewInvite,
  acceptInvite
};
