// Dela områden i Plugga — med kompisar eller via en länk/QR-kod. Den som får
// ett område delat får ingen kopia: hen läggs till i `sharedWith`, övar med
// sin egen progress och ser skaparens rättningar direkt. Bara skaparen (och
// skaparens AI) kan ändra innehållet. Poängen är att även den som INTE har
// någon AI kan plugga på det en kompis har skapat.
//
// Alla som ser ett område kan dela det vidare (services/sharedVia.js): med
// sina kompisar eller med en egen länk. Skaparen ser alla som har området
// ("via …") och kan ta bort vem som helst; den som delat vidare ser bara dem
// hen själv lagt till. Mottagaren ser den som delade med hen — aldrig
// skaparens namn om det var någon annan. Har skaparen och mottagaren blockerat
// varandra kommer området aldrig fram, vem som än delar.
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
const { sharerOf, blockChecker, profiles, visibleRecipients, canRemove } = require('../sharedVia');

const ownerId = (unit) => String(unit.user?._id || unit.user);
const isMember = (unit, userId) =>
  ownerId(unit) === String(userId) || (unit.sharedWith || []).some((id) => String(id) === String(userId));

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

/**
 * Vilka har området? Skaparen ser alla (med `via` för dem någon annan lagt
 * till); den som delat vidare ser bara dem hen själv lagt till. Enheten måste
 * ha `user`, `sharedWith` och `sharedVia`.
 */
async function listRecipients(unit, viewerId = ownerId(unit)) {
  return visibleRecipients(unit, viewerId);
}

/** Områden i id-ordning med ett filter, eller null om något id saknas/ogiltigt. */
async function loadUnitsWhere(unitIds, filter) {
  const ids = [...new Set((unitIds || []).map((id) => String(id).toLowerCase()))];
  if (!ids.length || ids.length > MAX_UNITS_PER_SHARE || ids.some((id) => !isId(id))) return null;
  const units = await StudyUnit.find({ _id: { $in: ids.map(oid) }, archivedAt: null, ...filter });
  if (units.length !== ids.length) return null;
  const byId = new Map(units.map((u) => [String(u._id), u]));
  return ids.map((id) => byId.get(id));
}

/** Egna, icke arkiverade områden (i id-ordning) — eller null om något inte är ens eget. */
function loadOwnedUnits(userId, unitIds) {
  return loadUnitsWhere(unitIds, { user: oid(userId) });
}

/**
 * Områden man får dela: egna och sådana som delats med en (inte arkiverade),
 * i id-ordning — eller null om något id inte är något man har.
 */
function loadShareableUnits(userId, unitIds) {
  return loadUnitsWhere(unitIds, { $or: [{ user: oid(userId) }, { sharedWith: oid(userId) }] });
}

/**
 * Dela ett eller flera områden man har (egna eller delade med en) med sina
 * kompisar. Bara bekräftade kompisar räknas (samma regel som för glos-listor).
 * Den som är skaparen, redan har området eller har blockerat skaparen (eller
 * blockerats av hen) hoppas tyst över — en blockering ska inte märkas.
 * Returnerar { units, friends, added } eller { error, status }.
 */
async function shareUnitsWithFriends(sharerId, units, friendIds) {
  const ids = [...new Set((friendIds || []).map(String).filter(isId))].filter((id) => id !== String(sharerId));
  if (!ids.length) return { error: 'Välj minst en kompis.', status: 400 };
  const friendships = await Friendship.find({ user: sharerId, friend: { $in: ids.map(oid) } }, 'friend').lean();
  const confirmed = friendships.map((f) => String(f.friend));
  if (!confirmed.length) return { error: 'Du kan bara dela med dina kompisar.', status: 400 };
  const blocked = await blockChecker([...confirmed, ...units.map(ownerId)]);
  const plans = units.map((u) => {
    const members = new Set((u.sharedWith || []).map(String));
    const adds = confirmed.filter((id) => id !== ownerId(u) && !members.has(id) && !blocked(ownerId(u), id));
    return { u, size: members.size + adds.length, adds };
  });
  const full = plans.find((p) => p.size > MAX_RECIPIENTS);
  if (full) {
    return { error: `Ett område kan delas med högst ${MAX_RECIPIENTS} personer${units.length > 1 ? ` (${full.u.code})` : ''}.`, status: 409 };
  }
  // En uppdatering per mottagare, bara om hen inte redan har området: delar två
  // med samma person samtidigt vinner den första, och den andra skriver ingen
  // egen rad (då skulle personen räknas som "via" fel person).
  const ops = plans.flatMap((p) => p.adds.map((id) => ({
    updateOne: {
      filter: { _id: p.u._id, sharedWith: { $ne: oid(id) } },
      update: {
        $addToSet: { sharedWith: oid(id) },
        // Skaparens egna delningar behöver ingen rad (saknad rad = skaparen delade).
        ...(ownerId(p.u) === String(sharerId) ? {} : { $push: { sharedVia: { user: oid(id), by: oid(sharerId) } } })
      }
    }
  })));
  const added = ops.length ? (await StudyUnit.bulkWrite(ops, { ordered: false })).modifiedCount : 0;
  if (added) await grantStudyFeature([...new Set(plans.flatMap((p) => p.adds))]);
  return { units: units.length, friends: confirmed.length, added };
}

/** Dela ett område med kompisar (områdessidan). Returnerar { recipients, added } eller { error, status }. */
async function shareWithFriends(sharerId, unit, friendIds) {
  const r = await shareUnitsWithFriends(sharerId, [unit], friendIds);
  if (r.error) return r;
  const fresh = await StudyUnit.findById(unit._id, 'user sharedWith sharedVia').lean();
  return { recipients: await listRecipients(fresh, sharerId), added: r.added };
}

/** Ta bort någon ur delningen — och området ur hens mappar, länkar och öppna felrapporter. */
async function removeRecipient(unit, userId) {
  if (!isId(userId)) return;
  await dropFrom([unit._id], oid(userId));
}

/**
 * Ta bort `recipient` ur områdena `ids`: ur delningen, ur hens mappar och
 * öppna felrapporter, och ur länkar hen gjort till dem (hen har ju inte
 * områdena längre, och läggs hen till igen ska en gammal länk inte vakna).
 */
async function dropFrom(ids, recipient) {
  if (!ids.length) return;
  await StudyUnit.updateMany({ _id: { $in: ids } }, { $pull: { sharedWith: recipient, sharedVia: { user: recipient } } });
  await StudyFolder.updateMany({ user: recipient, units: { $in: ids } }, { $pull: { units: { $in: ids } } });
  await StudyFlag.deleteMany({ unit: { $in: ids }, reporter: recipient, status: 'open' });
  const links = await StudyShareLink.find({ creator: recipient, revokedAt: null, $or: [{ unit: { $in: ids } }, { units: { $in: ids } }] });
  for (const link of links) await trimLink(link, ids); // eslint-disable-line no-await-in-loop
}

/**
 * Två kompisar tar bort varandra: inget område delas längre åt något håll —
 * varken den enas egna eller det den ena delat vidare till den andra. Samma
 * städning som removeRecipient (mappar, öppna felrapporter). Även den som
 * gått med via en länk tas bort. Samma sak när någon blockeras.
 */
async function unshareBetween(a, b) {
  if (!isId(a) || !isId(b)) return;
  for (const [giver, recipient] of [[oid(a), oid(b)], [oid(b), oid(a)]]) {
    const ids = (await StudyUnit.find({
      sharedWith: recipient,
      $or: [{ user: giver }, { sharedVia: { $elemMatch: { user: recipient, by: giver } } }]
    }, '_id').lean()).map((u) => u._id);
    // eslint-disable-next-line no-await-in-loop
    await dropFrom(ids, recipient);
  }
}

// ── länkar / QR ──────────────────────────────────────────────────────────────

/** Områdena en länk gäller: `units` på en länk till flera, annars `unit`. */
function linkUnitIds(link) {
  return link.units && link.units.length ? link.units : [link.unit];
}

/** Filter: länkar som gäller ett område — även länkar till flera. */
const coversUnit = (unitId) => ({ $or: [{ unit: unitId }, { units: unitId }] });

/**
 * Ta bort områdena `dropIds` ur en länk; gäller den inget område efter det
 * stängs den. Varje steg är en egen atomär uppdatering, så två som trimmar
 * samma länk samtidigt aldrig skriver tillbaka ett område den andra tog bort.
 */
async function trimLink(link, dropIds) {
  const drop = dropIds.map(oid);
  // 1. Ur listan över områden (en länk till ett område har ingen lista).
  await StudyShareLink.updateOne({ _id: link._id }, { $pull: { units: { $in: drop } } });
  // 2. Var det första området (`unit`) som togs bort: flytta det till det som nu står först.
  await StudyShareLink.updateOne(
    { _id: link._id, unit: { $in: drop }, 'units.0': { $exists: true } },
    [{ $set: { unit: { $arrayElemAt: ['$units', 0] } } }]
  );
  // 3. Gäller länken inget område längre: stäng den.
  await StudyShareLink.updateOne(
    { _id: link._id, unit: { $in: drop }, 'units.0': { $exists: false }, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

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
    id: String(l._id),
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
 * Skapa en länk/QR-kod till ett eller flera områden (t.ex. ett kapitel) som
 * anroparen har — egna eller delade med hen. Högst 3 aktiva länkar per område
 * och 30 per person. Returnerar { link } eller { error, status }.
 */
async function createShareLink(creatorId, units, { ttlDays, maxUses, title } = {}) {
  const list = Array.isArray(units) ? units : [units];
  if (!list.length) return { error: 'Välj minst ett område.', status: 400 };
  if (list.length > MAX_UNITS_PER_LINK) return { error: `En länk kan gälla högst ${MAX_UNITS_PER_LINK} områden.`, status: 400 };
  const ttl = LINK_TTL_DAYS.includes(Number(ttlDays)) ? Number(ttlDays) : 7;
  const uses = LINK_MAX_USES.includes(Number(maxUses)) ? Number(maxUses) : 30;
  const now = new Date();
  const active = await StudyShareLink.find({ creator: oid(creatorId), revokedAt: null, expiresAt: { $gt: now } }, 'unit units').lean();
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
    creator: creatorId,
    code: await uniqueLinkCode(),
    expiresAt: new Date(now.getTime() + ttl * 24 * 60 * 60 * 1000),
    maxUses: uses
  });
  return { link: linkOut(link) };
}

/** Filter: länkar som fortfarande går att använda (inte avstängda, utgångna eller fulla). */
const usable = () => ({
  revokedAt: null,
  expiresAt: { $gt: new Date() },
  $expr: { $lt: [{ $size: '$usedBy' }, '$maxUses'] }
});

/**
 * De aktiva länkarna som gäller ett område (områdessidans Dela), nyast först.
 * Skaparen ser alla — även länkar andra gjort (med `via`) — andra bara sina
 * egna. Andras länkar lämnas ut med id, aldrig med koden: skaparen ska kunna
 * stänga dem, inte använda eller sprida dem. Enheten måste ha `user` och `sharedWith`.
 */
async function listShareLinks(unit, viewerId = ownerId(unit)) {
  const owner = ownerId(unit);
  const viewer = String(viewerId);
  const isOwner = owner === viewer;
  const mine = isOwner ? {} : { creator: oid(viewer) };
  const links = (await StudyShareLink.find({ ...coversUnit(unit._id), ...usable(), ...mine }).sort({ createdAt: -1 }).limit(100).lean())
    // En länk gäller bara så länge den som gjort den har området.
    .filter((l) => isMember(unit, l.creator));
  const names = isOwner ? await profiles(links.map((l) => l.creator).filter((c) => String(c) !== owner)) : new Map();
  return links.map((l) => {
    if (String(l.creator) === viewer) return { ...linkOut(l), via: null };
    const { code, ...out } = linkOut(l); // eslint-disable-line no-unused-vars
    return { ...out, via: names.get(String(l.creator))?.username || 'ett raderat konto' };
  });
}

/**
 * Stäng av en länk till området — via koden (ens egna) eller länkens id (som
 * skaparen ser andras länkar med). Den som gjort länken stänger den helt
 * ('closed'). Områdets skapare kan stänga andras länkar till sina områden: då
 * tas hens områden bort ur länken och andras områden på samma länk påverkas
 * inte ('trimmed'). false = ingen sådan länk man får stänga.
 */
async function revokeShareLink(unit, ref, viewerId = ownerId(unit)) {
  const viewer = String(viewerId);
  const key = String(ref || '');
  const which = /^[a-f0-9]{24}$/i.test(key) ? { _id: oid(key) } : { code: key };
  const link = await StudyShareLink.findOne({ ...coversUnit(unit._id), ...which, revokedAt: null });
  if (!link) return false;
  if (String(link.creator) === viewer) {
    await StudyShareLink.updateOne({ _id: link._id }, { $set: { revokedAt: new Date() } });
    return 'closed';
  }
  if (ownerId(unit) !== viewer) return false;
  const own = await StudyUnit.find({ _id: { $in: linkUnitIds(link) }, user: oid(viewer) }, '_id').lean();
  await trimLink(link, own.map((u) => u._id));
  return 'trimmed';
}

/**
 * Ens alla aktiva länkar, med vilka områden de gäller (Plugga-sidornas Dela,
 * MCP) — bara områden man fortfarande har.
 */
async function listMyShareLinks(creatorId) {
  const me = oid(creatorId);
  const links = await StudyShareLink.find({ creator: me, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 }).limit(50).lean();
  const ids = [...new Set(links.flatMap((l) => linkUnitIds(l).map(String)))];
  const units = ids.length
    ? await StudyUnit.find({ _id: { $in: ids.map(oid) }, $or: [{ user: me }, { sharedWith: me }] }, 'code title').lean()
    : [];
  const byId = new Map(units.map((u) => [String(u._id), u]));
  return links.map((l) => ({
    ...linkOut(l),
    units: linkUnitIds(l).map((id) => byId.get(String(id))).filter(Boolean).map((u) => ({ id: String(u._id), code: u.code, title: u.title }))
  }));
}

async function revokeMyShareLink(creatorId, code) {
  const r = await StudyShareLink.updateOne(
    { creator: oid(creatorId), code: String(code || ''), revokedAt: null },
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
 * Länkens områden som finns kvar och som länkens skapare fortfarande har
 * (egna eller delade med hen, inte arkiverade), i länkens ordning. Förlorar
 * skaparen ett område slutar länken gälla det.
 */
async function linkUnits(link, fields) {
  const ids = linkUnitIds(link);
  const units = await StudyUnit.find({
    _id: { $in: ids },
    archivedAt: null,
    $or: [{ user: link.creator }, { sharedWith: link.creator }]
  }, fields).lean();
  const byId = new Map(units.map((u) => [String(u._id), u]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

/**
 * Publik förhandsvisning av en länk (ingen inloggning). null = ogiltig.
 * Bara det som behövs för att känna igen områdena — inte årskurs, bok eller
 * beskrivning, som säger mer om skaparen (ofta ett barn) än om innehållet.
 * `unit` = det första området (för en länk till ett område), `units` = alla.
 */
async function previewInvite(code, viewerId = null) {
  const link = await loadActiveLink(code);
  if (!link) return null;
  const [linked, creator] = await Promise.all([
    linkUnits(link, 'user code title subject term'),
    User.findById(link.creator, 'username avatar').lean()
  ]);
  if (!linked.length || !creator) return null;
  // Inloggad: samma urval som när man går med (acceptInvite) — så det man ser
  // är det man får. Blockerad med den som delar → länken ser död ut; områden
  // vars skapare man har en blockering med visas inte.
  let units = linked;
  if (viewerId && isId(viewerId) && String(viewerId) !== String(link.creator)) {
    if (await isBlockedBetween(viewerId, link.creator)) return null;
    const blocked = await blockChecker([String(viewerId), ...linked.map(ownerId)]);
    units = linked.filter((u) => !blocked(ownerId(u), viewerId));
    if (!units.length) return null;
  }
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
  const linked = await linkUnits(link, 'user sharedWith');
  if (!linked.length) return { error: 'Området finns inte längre.', status: 404 };
  const uid = oid(userId);
  if (String(link.creator) === String(userId)) {
    const own = linked.map((u) => String(u._id));
    return { unitId: own[0], unitIds: own, joined: false, own: true };
  }
  // Blockerad åt något håll — med den som delar eller med skaparen av ett
  // område → länken ser bara ut att inte fungera för det.
  if (await isBlockedBetween(userId, link.creator)) return { error: LINK_GONE, status: 404 };
  const blocked = await blockChecker([String(userId), ...linked.map(ownerId)]);
  const units = linked.filter((u) => !blocked(ownerId(u), userId));
  if (!units.length) return { error: LINK_GONE, status: 404 };
  const member = (u) => isMember(u, userId);
  const toJoin = units.filter((u) => !member(u) && (u.sharedWith || []).length < MAX_RECIPIENTS);
  // Svaret räknar bara områden man faktiskt är med i (ett fullt område hoppas över).
  const memberIds = units.filter((u) => member(u) || toJoin.includes(u)).map((u) => String(u._id));
  const full = units.length - memberIds.length;
  if (!toJoin.length) {
    if (!units.every(member)) return { error: `Området är redan delat med ${MAX_RECIPIENTS} personer.`, status: 409 };
    await grantStudyFeature([userId]);
    return { unitId: memberIds[0], unitIds: memberIds, joined: false };
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
  // Den som gick med fick områdena av länkens skapare — som kan ha delat
  // vidare (då en rad i sharedVia) eller skapat dem själv (ingen rad).
  const creator = String(link.creator);
  const ownJoin = toJoin.filter((u) => ownerId(u) === creator).map((u) => u._id);
  const viaJoin = toJoin.filter((u) => ownerId(u) !== creator).map((u) => u._id);
  if (ownJoin.length) {
    await StudyUnit.updateMany({ _id: { $in: ownJoin }, sharedWith: { $ne: uid } }, { $addToSet: { sharedWith: uid } });
  }
  if (viaJoin.length) {
    await StudyUnit.updateMany(
      { _id: { $in: viaJoin }, sharedWith: { $ne: uid } },
      { $addToSet: { sharedWith: uid }, $push: { sharedVia: { user: uid, by: oid(link.creator) } } }
    );
  }
  await grantStudyFeature([userId]);
  return { unitId: memberIds[0], unitIds: memberIds, joined: true, ...(full ? { full } : {}) };
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
  loadShareableUnits,
  isMember,
  sharerOf,
  canRemove,
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
