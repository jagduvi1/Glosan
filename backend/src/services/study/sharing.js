// Dela områden i Plugga — med kompisar eller via en länk/QR-kod. Den som får
// ett område delat får ingen kopia: hen läggs till i `sharedWith`, övar med
// sin egen progress och ser skaparens rättningar direkt. Bara skaparen (och
// skaparens AI) kan ändra innehållet. Poängen är att även den som INTE har
// någon AI kan plugga på det en kompis har skapat.
//
// Man kan dela flera områden på en gång (ett kapitel, en mapp): med kompisar,
// eller med EN länk som gäller alla — från Plugga-sidorna och via MCP.
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
const { isBlockedBetween } = require('../blocks');

const MAX_RECIPIENTS = 300;
const MAX_ACTIVE_LINKS_PER_UNIT = 3;
const MAX_ACTIVE_LINKS_PER_CREATOR = 30;
const MAX_UNITS_PER_SHARE = 100;
const MAX_UNITS_PER_LINK = 50;
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
 * Egna, icke arkiverade områden i den ordning id:na kom — eller null om något
 * id är ogiltigt, någon annans, arkiverat eller saknas (dela bara det man äger).
 */
async function loadOwnedUnits(userId, unitIds) {
  const ids = [...new Set((unitIds || []).map(String))];
  if (!ids.length || ids.length > MAX_UNITS_PER_SHARE || ids.some((id) => !isId(id))) return null;
  const units = await StudyUnit.find({ _id: { $in: ids.map(oid) }, user: oid(userId), archivedAt: null });
  if (units.length !== ids.length) return null;
  const byId = new Map(units.map((u) => [String(u._id), u]));
  return ids.map((id) => byId.get(id));
}

/**
 * Dela ett eller flera egna områden med kompisar. Bara bekräftade kompisar
 * räknas (samma regel som för glos-listor). `units` = områdesdokument som
 * anroparen äger. Returnerar { units, friends, added } eller { error, status }.
 */
async function shareUnitsWithFriends(ownerId, units, friendIds) {
  const ids = [...new Set((friendIds || []).map(String).filter(isId))].filter((id) => id !== String(ownerId));
  if (!ids.length) return { error: 'Välj minst en kompis.', status: 400 };
  const friendships = await Friendship.find({ user: ownerId, friend: { $in: ids.map(oid) } }, 'friend').lean();
  const confirmed = friendships.map((f) => String(f.friend));
  if (!confirmed.length) return { error: 'Du kan bara dela med dina kompisar.', status: 400 };
  const members = (u) => new Set((u.sharedWith || []).map(String));
  const full = units.find((u) => new Set([...members(u), ...confirmed]).size > MAX_RECIPIENTS);
  if (full) {
    return { error: `Ett område kan delas med högst ${MAX_RECIPIENTS} personer${units.length > 1 ? ` (${full.code})` : ''}.`, status: 409 };
  }
  const added = units.reduce((n, u) => n + confirmed.filter((id) => !members(u).has(id)).length, 0);
  if (added) {
    await StudyUnit.updateMany({ _id: { $in: units.map((u) => u._id) } }, { $addToSet: { sharedWith: { $each: confirmed.map(oid) } } });
    await grantStudyFeature(confirmed);
  }
  return { units: units.length, friends: confirmed.length, added };
}

/** Dela ett område med kompisar (områdessidan). Returnerar { recipients, added } eller { error, status }. */
async function shareWithFriends(ownerId, unit, friendIds) {
  const r = await shareUnitsWithFriends(ownerId, [unit], friendIds);
  if (r.error) return r;
  const fresh = await StudyUnit.findById(unit._id, 'sharedWith').lean();
  return { recipients: await listRecipients(fresh), added: r.added };
}

/** Ta bort någon ur delningen — och området ur hens mappar och hens öppna felrapporter. */
async function removeRecipient(unit, userId) {
  if (!isId(userId)) return;
  await StudyUnit.updateOne({ _id: unit._id }, { $pull: { sharedWith: oid(userId) } });
  await StudyFolder.updateMany({ user: oid(userId), units: unit._id }, { $pull: { units: unit._id } });
  await StudyFlag.deleteMany({ unit: unit._id, reporter: oid(userId), status: 'open' });
}

/**
 * Två kompisar tar bort varandra: inget område delas längre åt något håll —
 * samma städning som removeRecipient (mappar, öppna felrapporter). Även den
 * som gått med via en länk tas bort. Samma sak när någon blockeras.
 */
async function unshareBetween(a, b) {
  if (!isId(a) || !isId(b)) return;
  for (const [owner, recipient] of [[oid(a), oid(b)], [oid(b), oid(a)]]) {
    const ids = (await StudyUnit.find({ user: owner, sharedWith: recipient }, '_id').lean()).map((u) => u._id);
    if (!ids.length) continue;
    await StudyUnit.updateMany({ _id: { $in: ids } }, { $pull: { sharedWith: recipient } });
    await StudyFolder.updateMany({ user: recipient, units: { $in: ids } }, { $pull: { units: { $in: ids } } });
    await StudyFlag.deleteMany({ unit: { $in: ids }, reporter: recipient, status: 'open' });
  }
}

// ── länkar / QR ──────────────────────────────────────────────────────────────

/** Områdena en länk gäller: `units` på en länk till flera, annars `unit`. */
function linkUnitIds(link) {
  return link.units && link.units.length ? link.units : [link.unit];
}

/** Filter: länkar som gäller ett område — även länkar till flera. */
const coversUnit = (unitId) => ({ $or: [{ unit: unitId }, { units: unitId }] });

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
    title: l.title || '',
    unitCount: linkUnitIds(l).length,
    expiresAt: l.expiresAt,
    maxUses: l.maxUses,
    usedCount: (l.usedBy || []).length,
    revoked: Boolean(l.revokedAt),
    createdAt: l.createdAt
  };
}

/**
 * Skapa en länk/QR-kod till ett eller flera egna områden (t.ex. ett kapitel).
 * `units` = ett områdesdokument eller en lista, som anroparen äger. Högst 3
 * aktiva länkar per område och 30 per skapare. Returnerar { link } eller
 * { error, status }.
 */
async function createShareLink(ownerId, units, { ttlDays, maxUses, title } = {}) {
  const list = Array.isArray(units) ? units : [units];
  if (!list.length) return { error: 'Välj minst ett område.', status: 400 };
  if (list.length > MAX_UNITS_PER_LINK) return { error: `En länk kan gälla högst ${MAX_UNITS_PER_LINK} områden.`, status: 400 };
  const ttl = LINK_TTL_DAYS.includes(Number(ttlDays)) ? Number(ttlDays) : 7;
  const uses = LINK_MAX_USES.includes(Number(maxUses)) ? Number(maxUses) : 30;
  const now = new Date();
  const active = await StudyShareLink.find({ creator: oid(ownerId), revokedAt: null, expiresAt: { $gt: now } }, 'unit units').lean();
  if (active.length >= MAX_ACTIVE_LINKS_PER_CREATOR) {
    return { error: `Du har redan ${active.length} aktiva länkar — stäng av någon först.`, status: 429 };
  }
  for (const u of list) {
    const n = active.filter((l) => linkUnitIds(l).some((id) => String(id) === String(u._id))).length;
    if (n >= MAX_ACTIVE_LINKS_PER_UNIT) {
      return { error: `Du har redan ${n} aktiva länkar för ${list.length > 1 ? u.code : 'området'} — stäng av någon först.`, status: 429 };
    }
  }
  const ids = list.map((u) => u._id);
  const link = await StudyShareLink.create({
    unit: ids[0],
    ...(ids.length > 1 ? { units: ids } : {}),
    title: typeof title === 'string' ? title.trim().slice(0, 100) : '',
    creator: ownerId,
    code: await uniqueLinkCode(),
    expiresAt: new Date(now.getTime() + ttl * 24 * 60 * 60 * 1000),
    maxUses: uses
  });
  return { link: linkOut(link) };
}

/** Länkarna som gäller ett område (områdessidans Dela), nyast först. */
async function listShareLinks(unit) {
  const links = await StudyShareLink.find(coversUnit(unit._id)).sort({ createdAt: -1 }).limit(20).lean();
  return links.map(linkOut);
}

async function revokeShareLink(unit, code) {
  const r = await StudyShareLink.updateOne(
    { ...coversUnit(unit._id), code: String(code || ''), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return r.matchedCount > 0;
}

/** Skaparens alla aktiva länkar, med vilka områden de gäller (Plugga-sidornas Dela, MCP). */
async function listMyShareLinks(ownerId) {
  const links = await StudyShareLink.find({ creator: oid(ownerId), revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 }).limit(50).lean();
  const ids = [...new Set(links.flatMap((l) => linkUnitIds(l).map(String)))];
  const units = ids.length ? await StudyUnit.find({ _id: { $in: ids.map(oid) } }, 'code title').lean() : [];
  const byId = new Map(units.map((u) => [String(u._id), u]));
  return links.map((l) => ({
    ...linkOut(l),
    units: linkUnitIds(l).map((id) => byId.get(String(id))).filter(Boolean).map((u) => ({ id: String(u._id), code: u.code, title: u.title }))
  }));
}

async function revokeMyShareLink(ownerId, code) {
  const r = await StudyShareLink.updateOne(
    { creator: oid(ownerId), code: String(code || ''), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return r.matchedCount > 0;
}

async function loadActiveLink(code) {
  if (typeof code !== 'string' || !/^[A-Z0-9]{4,16}$/.test(code)) return null;
  const link = await StudyShareLink.findOne({ code });
  return link && link.isActive() ? link : null;
}

/** Länkens områden som finns kvar (inte arkiverade, fortfarande skaparens), i länkens ordning. */
async function linkUnits(link, fields) {
  const ids = linkUnitIds(link);
  const units = await StudyUnit.find({ _id: { $in: ids }, user: link.creator, archivedAt: null }, fields).lean();
  const byId = new Map(units.map((u) => [String(u._id), u]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

/**
 * Publik förhandsvisning av en länk (ingen inloggning). null = ogiltig.
 * Bara det som behövs för att känna igen områdena — inte årskurs, bok eller
 * beskrivning, som säger mer om skaparen (ofta ett barn) än om innehållet.
 * `unit` = det första området (för en länk till ett område), `units` = alla.
 */
async function previewInvite(code) {
  const link = await loadActiveLink(code);
  if (!link) return null;
  const [units, creator] = await Promise.all([
    linkUnits(link, 'code title subject term'),
    User.findById(link.creator, 'username avatar').lean()
  ]);
  if (!units.length || !creator) return null;
  const unitIds = units.map((u) => u._id);
  const [pages, kinds] = await Promise.all([
    StudyPage.aggregate([{ $match: { unit: { $in: unitIds } } }, { $group: { _id: '$unit', n: { $sum: 1 } } }]),
    StudyItem.aggregate([
      { $match: { unit: { $in: unitIds }, usage: 'practice' } },
      { $group: { _id: { unit: '$unit', kind: '$kind' }, n: { $sum: 1 } } }
    ])
  ]);
  const pageCount = (u) => pages.find((r) => String(r._id) === String(u._id))?.n || 0;
  const count = (u, k) => kinds.find((r) => String(r._id.unit) === String(u._id) && r._id.kind === k)?.n || 0;
  const summaries = units.map((u) => {
    const subject = getSubject(u.subject);
    return {
      code: u.code,
      title: u.title,
      subject: u.subject,
      subjectLabel: subject?.label || u.subject,
      emoji: subject?.emoji || '',
      termLabel: termLabel(u.term),
      pages: pageCount(u),
      cards: count(u, 'card'),
      exercises: count(u, 'exercise')
    };
  });
  return {
    unit: summaries[0],
    units: summaries,
    title: link.title || null,
    creator: { username: creator.username, avatar: creator.avatar || null },
    expiresAt: link.expiresAt,
    remainingUses: link.maxUses - link.usedBy.length
  };
}

/**
 * Gå med i delade områden via länk. Idempotent: den som redan är med i allt
 * (eller äger det) skickas bara vidare, utan att förbruka en plats på länken.
 * Man blir INTE kompis med skaparen — en länk kan ha spridits vidare, och
 * kompisar ser varandras streak och kan dela och utmana.
 * Returnerar { unitId, unitIds, joined } eller { error, status }.
 */
async function acceptInvite(userId, code) {
  const link = await loadActiveLink(code);
  if (!link) return { error: LINK_GONE, status: 404 };
  // En åtkomsttoken lever 15 min efter att kontot raderats — inga spökmedlemmar.
  if (!(await User.exists({ _id: oid(userId) }))) return { error: 'Logga in igen.', status: 401 };
  const units = await linkUnits(link, 'user sharedWith');
  if (!units.length) return { error: 'Området finns inte längre.', status: 404 };
  const unitIds = units.map((u) => String(u._id));
  const uid = oid(userId);
  if (String(link.creator) === String(userId)) return { unitId: unitIds[0], unitIds, joined: false, own: true };
  // Blockerad åt något håll → länken ser bara ut att inte fungera.
  if (await isBlockedBetween(userId, link.creator)) return { error: LINK_GONE, status: 404 };
  const isMember = (u) => (u.sharedWith || []).some((id) => String(id) === String(userId));
  const toJoin = units.filter((u) => !isMember(u) && (u.sharedWith || []).length < MAX_RECIPIENTS);
  if (!toJoin.length) {
    if (!units.every(isMember)) return { error: `Området är redan delat med ${MAX_RECIPIENTS} personer.`, status: 409 };
    await grantStudyFeature([userId]);
    return { unitId: unitIds[0], unitIds, joined: false };
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
  await StudyUnit.updateMany({ _id: { $in: toJoin.map((u) => u._id) } }, { $addToSet: { sharedWith: uid } });
  await grantStudyFeature([userId]);
  return { unitId: unitIds[0], unitIds, joined: true };
}

module.exports = {
  MAX_RECIPIENTS,
  MAX_UNITS_PER_SHARE,
  MAX_UNITS_PER_LINK,
  LINK_TTL_DAYS,
  LINK_MAX_USES,
  grantStudyFeature,
  listRecipients,
  loadOwnedUnits,
  shareUnitsWithFriends,
  shareWithFriends,
  removeRecipient,
  unshareBetween,
  createShareLink,
  listShareLinks,
  revokeShareLink,
  listMyShareLinks,
  revokeMyShareLink,
  previewInvite,
  acceptInvite
};
