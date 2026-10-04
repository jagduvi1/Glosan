// Dela = ge en kopia (sedan v0.1.38). Den som får ett område delat får en
// EGEN kopia: hen äger den, kan ta bort det hen inte vill ha (papperskorgen,
// eller hela kopian) och — med sin egen AI — ändra och lägga till. Ändringar i
// originalet når inte kopian.
//
// Delar man igen får mottagaren bara det nya: ett område hen inte har blir en
// ny kopia, och nya genomgångar, kort, övningar och prov i ett område hen
// redan har läggs till i hens kopia. Aldrig något hen tagit bort, och inget hen
// ändrat skrivs över.
//
// Man har högst EN kopia per original, hur många vägar det än kommer (Majken
// delar med A och B, båda delar med C → C har en kopia). Därför minns allt i en
// kopia sitt ORIGINAL — det som står först i kedjan av kopior:
//   StudyUnit.copiedFrom { unit, root, by, origin, givers, at }
//   copiedFrom (originalets id) på varje sida, uppgift och prov
// Det ägaren tar bort ur sin kopia minns i StudyUnit.copyDropped (originalens
// id) — borttagningsloggen gallras efter 180 dagar, det här får aldrig glömmas.
//
// De som delades med före kopiorna följer originalet (sharedWith) som förut.
const StudyUnit = require('../../models/StudyUnit');
const StudyPage = require('../../models/StudyPage');
const StudyItem = require('../../models/StudyItem');
const StudyTest = require('../../models/StudyTest');
const { oid } = require('./access');
const { blockChecker, profiles } = require('../sharedVia');
const { withUserLock } = require('../../utils/userLock');
const L = require('./limits');

const ownerOf = (unit) => String(unit.user?._id || unit.user);
/** Originalet först i kedjan (ett original är sitt eget). */
const rootOf = (unit) => String(unit.copiedFrom?.root || unit._id);
/** Den som skapade originalet (för blockeringar längs kedjan). */
const originOf = (unit) => String(unit.copiedFrom?.origin || unit.user?._id || unit.user);
/** Originalet för en sida, uppgift eller ett prov. */
const rootOfDoc = (doc) => String(doc.copiedFrom || doc._id);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/** Det som inte följer med till en kopia: id, ägare, tider och källans ursprung. */
function contentOf(doc) {
  const { _id, __v, unit, user, createdAt, updatedAt, copiedFrom, ...rest } = doc; // eslint-disable-line no-unused-vars
  return rest;
}

/** Mottagarens kopia av originalet `rootId`, om hen har en (även arkiverad). */
function findCopy(recipientId, rootId) {
  return StudyUnit.findOne({ user: oid(recipientId), 'copiedFrom.root': oid(rootId) }).sort({ createdAt: 1 });
}

/**
 * Lägg in det i `source` som `copy` inte har och inte tagit bort: genomgångar,
 * kort och övningar, och prov med sina frågor. Jämförs på original, så samma
 * innehåll som kommer en annan väg aldrig blir dubbelt. En ny kopia behåller
 * källans uppgiftsnummer (MA1-14 hos den som delade är MA2-14 i kopian); det
 * som läggs till senare får nästa lediga nummer i kopian. Inget som redan
 * finns ändras. Ryms inte allt (tak per område och konto) läggs det in som ryms.
 * Returnerar { pages, items, tests } — hur mycket som lades till.
 */
async function copyContent(source, copy, recipientId, { fresh = false } = {}) {
  const me = oid(recipientId);
  const [srcPages, srcItems, srcTests, havePages, haveItems, haveTests, inAccount] = await Promise.all([
    StudyPage.find({ unit: source._id }).sort({ order: 1, createdAt: 1 }).lean(),
    StudyItem.find({ unit: source._id }).sort({ number: 1 }).lean(),
    StudyTest.find({ unit: source._id }).sort({ createdAt: 1 }).lean(),
    fresh ? [] : StudyPage.find({ unit: copy._id }, 'copiedFrom order').lean(),
    fresh ? [] : StudyItem.find({ unit: copy._id }, 'copiedFrom').lean(),
    fresh ? [] : StudyTest.find({ unit: copy._id }, 'copiedFrom').lean(),
    StudyItem.countDocuments({ user: me })
  ]);
  const known = new Set([
    ...(copy.copyDropped || []),
    ...havePages.map((p) => p.copiedFrom),
    ...haveItems.map((i) => i.copiedFrom),
    ...haveTests.map((t) => t.copiedFrom)
  ].filter(Boolean).map(String));
  const isNew = (doc) => !known.has(rootOfDoc(doc));

  const pages = srcPages.filter(isNew).slice(0, Math.max(0, L.MAX_PAGES_PER_UNIT - havePages.length));
  const nextOrder = havePages.reduce((m, p) => Math.max(m, (p.order || 0) + 1), 0);

  // Övningsuppgifter för sig; provfrågor bara tillsammans med sitt (nya) prov,
  // så ett prov aldrig kommer halvt.
  let room = Math.min(L.MAX_ITEMS_PER_UNIT - haveItems.length, L.MAX_ITEMS_PER_ACCOUNT - inAccount);
  const inTests = new Set(srcTests.flatMap((t) => t.questions.map((q) => String(q.item))));
  const toCopy = [];
  for (const i of srcItems) {
    if (room <= 0) break;
    if (i.usage === 'test' || inTests.has(String(i._id)) || !isNew(i)) continue;
    toCopy.push(i);
    room -= 1;
  }
  const byId = new Map(srcItems.map((i) => [String(i._id), i]));
  const tests = [];
  for (const t of srcTests) {
    if (!isNew(t)) continue;
    const questionItems = t.questions.map((q) => byId.get(String(q.item))).filter(Boolean);
    if (!questionItems.length || questionItems.length > room) continue;
    tests.push(t);
    toCopy.push(...questionItems);
    room -= questionItems.length;
  }

  let numbers = toCopy.map((i) => i.number);
  if (!fresh && toCopy.length) {
    const first = await StudyUnit.reserveItemNumbers(copy._id, toCopy.length);
    numbers = toCopy.map((_, k) => first + k);
  }
  // ordered: false — en äldre uppgift som inte klarar dagens kontroller hoppas
  // över i stället för att stoppa resten.
  const inserted = toCopy.length
    ? await StudyItem.insertMany(toCopy.map((i, k) => ({
      ...contentOf(i), unit: copy._id, user: me, number: numbers[k], copiedFrom: oid(rootOfDoc(i))
    })), { ordered: false })
    : [];
  const copied = new Map(inserted.map((d) => [String(d.copiedFrom), d._id]));

  let testCount = 0;
  for (const t of tests) {
    const questions = t.questions
      .map((q) => {
        const src = byId.get(String(q.item));
        return { item: src && copied.get(rootOfDoc(src)), points: q.points, part: q.part || '' };
      })
      .filter((q) => q.item);
    if (!questions.length) continue;
    // eslint-disable-next-line no-await-in-loop
    await StudyTest.create({ ...contentOf(t), questions, unit: copy._id, user: me, copiedFrom: oid(rootOfDoc(t)) });
    testCount += 1;
  }

  if (pages.length) {
    await StudyPage.insertMany(pages.map((p, k) => ({
      ...contentOf(p), unit: copy._id, user: me, order: fresh ? (p.order || 0) : nextOrder + k, copiedFrom: oid(rootOfDoc(p))
    })), { ordered: false });
  }
  return { pages: pages.length, items: inserted.length, tests: testCount };
}

/**
 * Ge `recipientId` en kopia av `source` — eller, har hen redan en kopia av
 * samma original, det nya i den. Har hen originalet själv (skapat det, eller
 * följer det från före kopiorna) får hen inget.
 * Returnerar { unitId (det hen har), created, added } eller null (ingen plats).
 * Körs under mottagarens lås (giveCopies).
 */
async function giveCopy(sharerId, sourceDoc, recipientId) {
  const source = plain(sourceDoc);
  const r = String(recipientId);
  const root = rootOf(source);
  const original = await StudyUnit.findOne({ _id: oid(root), $or: [{ user: oid(r) }, { sharedWith: oid(r) }] }, '_id').lean();
  if (original) return { unitId: String(original._id), created: false, added: 0 };
  const sum = (a) => a.pages + a.items + a.tests;
  const existing = await findCopy(r, root);
  if (existing) {
    const added = await copyContent(source, existing, r);
    // Hen har nu fått det av den här personen också (hens "har fått en kopia av dig").
    await StudyUnit.updateOne({ _id: existing._id }, { $addToSet: { 'copiedFrom.givers': oid(sharerId) } });
    return { unitId: String(existing._id), created: false, added: sum(added) };
  }
  const [active, total] = await Promise.all([
    StudyUnit.countDocuments({ user: oid(r), archivedAt: null }),
    StudyUnit.countDocuments({ user: oid(r) })
  ]);
  if (active >= L.MAX_UNITS_PER_USER || total >= L.MAX_UNITS_TOTAL) return null;
  const copy = await StudyUnit.create({
    user: oid(r),
    subject: source.subject,
    term: source.term,
    gradeYear: source.gradeYear ?? null,
    code: await StudyUnit.nextCode(r, source.subject),
    title: source.title,
    description: source.description || '',
    source: source.source || {},
    examDate: source.examDate || null,
    itemCounter: source.itemCounter || 0,
    copiedFrom: {
      unit: source._id, root: oid(root), by: oid(sharerId), origin: oid(originOf(source)), givers: [oid(sharerId)], at: new Date()
    }
  });
  const added = await copyContent(source, copy, r, { fresh: true });
  return { unitId: String(copy._id), created: true, added: sum(added) };
}

/** Högst så här många par (mottagare × område) per delning — varje par kan bli en hel kopia. */
const MAX_COPY_PAIRS = 300;

/**
 * Ge var och en av `recipientIds` kopior av `units` (det nya, om hen redan har
 * en kopia). Den som har en blockering med originalets skapare hoppas tyst
 * över — en blockering ska inte märkas. Returnerar
 * { created, updated, copies: Map(mottagare → [det hen har av varje område, i `units` ordning]) }.
 */
async function giveCopies(sharerId, units, recipientIds) {
  const recipients = [...new Set(recipientIds.map(String))];
  const blocked = await blockChecker([...recipients, ...units.map(originOf)]);
  let created = 0;
  let updated = 0;
  const copies = new Map();
  for (const r of recipients) {
    // eslint-disable-next-line no-await-in-loop
    await withUserLock(r, async () => {
      const mine = [];
      for (const u of units) {
        if (blocked(originOf(u), r)) continue;
        // eslint-disable-next-line no-await-in-loop
        const res = await giveCopy(sharerId, u, r);
        if (!res) continue;
        mine.push(res.unitId);
        if (res.created) created += 1;
        else if (res.added) updated += 1;
      }
      copies.set(r, mine);
    });
  }
  return { created, updated, copies };
}

/**
 * Vilka har fått en kopia av området av `viewerId` (de har en kopia av samma
 * original, och `viewerId` har delat det med dem)? [{ _id, username, avatar }], på namn.
 */
async function copiesGivenBy(unit, viewerId) {
  const copies = await StudyUnit.find(
    { 'copiedFrom.root': oid(rootOf(unit)), 'copiedFrom.givers': oid(viewerId), user: { $ne: oid(viewerId) } },
    'user'
  ).lean();
  const names = await profiles(copies.map((c) => c.user));
  const seen = new Map();
  for (const c of copies) {
    const id = String(c.user);
    if (names.has(id)) seen.set(id, { _id: id, username: names.get(id).username, avatar: names.get(id).avatar });
  }
  return [...seen.values()].sort((a, b) => a.username.localeCompare(b.username, 'sv'));
}

/** Hur många `viewerId` gett en kopia av varje område: Map(områdets id → n). */
async function copyCounts(units, viewerId) {
  if (!units.length) return new Map();
  const rows = await StudyUnit.aggregate([
    { $match: { 'copiedFrom.root': { $in: [...new Set(units.map(rootOf))].map(oid) }, 'copiedFrom.givers': oid(viewerId), user: { $ne: oid(viewerId) } } },
    { $group: { _id: '$copiedFrom.root', users: { $addToSet: '$user' } } }
  ]);
  const byRoot = new Map(rows.map((r) => [String(r._id), r.users.length]));
  return new Map(units.map((u) => [String(u._id), byRoot.get(rootOf(u)) || 0]));
}

/** Minns att ägaren tagit bort det här ur sin kopia (originalens id), så en ny delning inte lägger tillbaka det. */
async function markDropped(unitId, rootIds) {
  const ids = (rootIds || []).filter(Boolean).map(oid);
  if (ids.length) await StudyUnit.updateOne({ _id: unitId }, { $addToSet: { copyDropped: { $each: ids } } });
}

/** Ångrat: får komma med igen. */
async function unmarkDropped(unitId, rootIds) {
  const ids = (rootIds || []).filter(Boolean).map(oid);
  if (ids.length) await StudyUnit.updateOne({ _id: unitId }, { $pull: { copyDropped: { $in: ids } } });
}

module.exports = {
  MAX_COPY_PAIRS, rootOf, originOf, findCopy, copyContent, giveCopy, giveCopies, copiesGivenBy, copyCounts, markDropped, unmarkDropped
};
