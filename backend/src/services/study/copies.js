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
// Det ägaren själv lägger till i sin kopia är sitt eget original (sitt id).
// Det ägaren tar bort ur sin kopia minns i StudyUnit.copyDropped (originalens
// id) — borttagningsloggen gallras efter 180 dagar, det här får aldrig glömmas.
//
// Blockeringar: inget som någon man har en blockering med skrivit kommer fram
// — varken originalets skapare (då inget alls) eller den som lagt till något
// längs vägen (då inte det hen lagt till).
//
// De som delades med före kopiorna följer originalet (sharedWith) som förut.
const StudyUnit = require('../../models/StudyUnit');
const StudyPage = require('../../models/StudyPage');
const StudyItem = require('../../models/StudyItem');
const StudyTest = require('../../models/StudyTest');
const { oid } = require('./access');
const { blockChecker, profiles } = require('../sharedVia');
const { deleteStudyUnitsCascade } = require('../studyData');
const { withUserLock } = require('../../utils/userLock');
const L = require('./limits');

/** Högst så här många par (mottagare × område) per delning — varje par kan bli en hel kopia. */
const MAX_COPY_PAIRS = 100;

const ownerOf = (unit) => String(unit.user?._id || unit.user);
/** Originalet först i kedjan (ett original är sitt eget). */
const rootOf = (unit) => String(unit.copiedFrom?.root || unit._id);
/** Den som skapade originalet (för blockeringar längs kedjan). */
const originOf = (unit) => String(unit.copiedFrom?.origin || unit.user?._id || unit.user);
/** Originalet för en sida, uppgift eller ett prov — det man själv skrivit är sitt eget. */
const rootOfDoc = (doc) => String(doc.copiedFrom || doc._id);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/** Det som inte följer med till en kopia: id, ägare, tider och källans ursprung. */
function contentOf(doc) {
  const { _id, __v, unit, user, createdAt, updatedAt, copiedFrom, copyAuthor, copyEditors, ...rest } = doc; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * En kopierad sak (eller kopians titel och beskrivning) som ägaren ändrar:
 * hen räknas nu också som författare — det hen skrivit ska inte nå den som
 * blockerat hen. `path` = 'copyEditors' (sida/uppgift) eller 'copiedFrom.editors' (området).
 */
function markEdited(doc, userId, path = 'copyEditors') {
  const current = (doc.get(path) || []).map(String);
  if (!current.includes(String(userId))) doc.set(path, [...current, String(userId)]);
}

/** Mottagarens kopia av originalet `rootId`, om hen har en (även arkiverad). */
function findCopy(recipientId, rootId) {
  return StudyUnit.findOne({ user: oid(recipientId), 'copiedFrom.root': oid(rootId) }).sort({ createdAt: 1 });
}

/**
 * Källans innehåll — hämtas EN gång per delning, hur många som än får det —
 * och vem som skrev varje sak: det källans ägare själv lagt till är hens; en
 * kopierad sak minns sin författare (copyAuthor), och för äldre kopior slås
 * ägaren av originalet upp (finns det inte kvar vet vi inte — då följer det med).
 */
async function loadSource(sourceDoc) {
  const source = plain(sourceDoc);
  const [pages, items, tests] = await Promise.all([
    StudyPage.find({ unit: source._id }).sort({ order: 1, createdAt: 1 }).lean(),
    StudyItem.find({ unit: source._id }).sort({ number: 1 }).lean(),
    StudyTest.find({ unit: source._id }).sort({ createdAt: 1 }).lean()
  ]);
  const roots = (docs) => docs.filter((d) => d.copiedFrom && !d.copyAuthor).map((d) => d.copiedFrom);
  const [rp, ri, rt] = await Promise.all([
    StudyPage.find({ _id: { $in: roots(pages) } }, 'user').lean(),
    StudyItem.find({ _id: { $in: roots(items) } }, 'user').lean(),
    StudyTest.find({ _id: { $in: roots(tests) } }, 'user').lean()
  ]);
  const authorOfRoot = new Map([...rp, ...ri, ...rt].map((d) => [String(d._id), String(d.user)]));
  const owner = ownerOf(source);
  const authorOf = (doc) => {
    if (!doc.copiedFrom) return owner;
    if (doc.copyAuthor) return String(doc.copyAuthor);
    return authorOfRoot.get(String(doc.copiedFrom)) || null;
  };
  // Alla som skrivit något i en sak: författaren och de som ändrat den sedan.
  const writersOf = (doc) => [authorOf(doc), ...(doc.copyEditors || []).map(String)].filter(Boolean);
  // Områdets titel och beskrivning: den som ändrat dem i en kopia längs vägen.
  const unitEditors = (source.copiedFrom?.editors || []).map(String);
  const authors = new Set([...[...pages, ...items, ...tests].flatMap(writersOf), ...unitEditors]);
  return { source, pages, items, tests, authorOf, writersOf, unitEditors, authors: [...authors] };
}

/**
 * Lägg in det i källan som `copy` inte har och inte tagit bort: genomgångar,
 * kort och övningar, och prov med sina frågor. Jämförs på original, så samma
 * innehåll som kommer en annan väg aldrig blir dubbelt. En ny kopia behåller
 * källans uppgiftsnummer (MA1-14 hos den som delade är MA2-14 i kopian); det
 * som läggs till senare får nästa lediga nummer i kopian. Inget som redan
 * finns ändras. Ryms inte allt (tak per område och konto) läggs det in som ryms.
 * Returnerar { pages, items, tests } — hur mycket som lades till.
 */
async function copyContent(src, copy, recipientId, { fresh = false, blocked = () => false } = {}) {
  const me = oid(recipientId);
  const [havePages, haveItems, haveTests, inAccount] = await Promise.all([
    fresh ? [] : StudyPage.find({ unit: copy._id }, 'copiedFrom order').lean(),
    fresh ? [] : StudyItem.find({ unit: copy._id }, 'copiedFrom').lean(),
    fresh ? [] : StudyTest.find({ unit: copy._id }, 'copiedFrom').lean(),
    StudyItem.countDocuments({ user: me })
  ]);
  const dropped = new Set((copy.copyDropped || []).map(String));
  const known = new Set([...dropped, ...[...havePages, ...haveItems, ...haveTests].map(rootOfDoc)]);
  // Inget som någon mottagaren har en blockering med har skrivit eller ändrat.
  const allowed = (doc) => src.writersOf(doc).every((w) => w === String(recipientId) || !blocked(w, recipientId));
  const wanted = (doc) => !known.has(rootOfDoc(doc)) && allowed(doc);
  // Kopian minns vem som skrev originalet och vilka som ändrat det — även när
  // originalet tagits bort.
  const origin = (doc) => {
    const author = src.authorOf(doc);
    return {
      ...(author ? { copyAuthor: oid(author) } : {}),
      ...(doc.copyEditors?.length ? { copyEditors: doc.copyEditors.map(oid) } : {})
    };
  };

  const pages = src.pages.filter(wanted).slice(0, Math.max(0, L.MAX_PAGES_PER_UNIT - havePages.length));
  const nextOrder = havePages.reduce((m, p) => Math.max(m, (p.order || 0) + 1), 0);

  // Övningsuppgifter för sig; provfrågor bara tillsammans med sitt (nya) prov,
  // så ett prov aldrig kommer halvt.
  let room = Math.min(L.MAX_ITEMS_PER_UNIT - haveItems.length, L.MAX_ITEMS_PER_ACCOUNT - inAccount);
  const inTests = new Set(src.tests.flatMap((t) => t.questions.map((q) => String(q.item))));
  const practice = [];
  for (const i of src.items) {
    if (room <= 0) break;
    if (i.usage === 'test' || inTests.has(String(i._id)) || !wanted(i)) continue;
    practice.push(i);
    room -= 1;
  }
  const byId = new Map(src.items.map((i) => [String(i._id), i]));
  // Provfrågor kopian redan har (t.ex. efter ett avbrutet försök) används igen.
  const haveByRoot = new Map(haveItems.map((i) => [rootOfDoc(i), i._id]));
  const tests = [];
  for (const t of src.tests) {
    if (!wanted(t)) continue;
    const questionItems = t.questions.map((q) => byId.get(String(q.item))).filter((i) => i && !dropped.has(rootOfDoc(i)));
    const toInsert = questionItems.filter((i) => !haveByRoot.has(rootOfDoc(i)));
    if (!questionItems.length || toInsert.length > room) continue;
    tests.push({ t, toInsert });
    room -= toInsert.length;
  }

  // Nummer: en ny kopia behåller källans, annars nästa lediga i kopian.
  const all = [...practice, ...tests.flatMap((x) => x.toInsert)];
  const numberOf = new Map();
  if (fresh) {
    for (const i of all) numberOf.set(String(i._id), i.number);
    // Räknaren minst lika hög som det högsta numret, så nästa tillägg aldrig krockar.
    const max = all.reduce((m, i) => Math.max(m, i.number || 0), 0);
    if (max) await StudyUnit.updateOne({ _id: copy._id }, { $max: { itemCounter: max } });
  } else if (all.length) {
    const first = await StudyUnit.reserveItemNumbers(copy._id, all.length);
    all.forEach((i, k) => numberOf.set(String(i._id), first + k));
  }
  const asCopy = (i) => ({ ...contentOf(i), unit: copy._id, user: me, number: numberOf.get(String(i._id)), copiedFrom: oid(rootOfDoc(i)), ...origin(i) });

  // ordered: false — en äldre uppgift som inte klarar dagens kontroller hoppas
  // över i stället för att stoppa resten.
  const inserted = practice.length ? await StudyItem.insertMany(practice.map(asCopy), { ordered: false }) : [];
  let itemCount = inserted.length;
  let testCount = 0;
  for (const { t, toInsert } of tests) {
    // Ett prov och dess frågor hör ihop: går provet inte att spara tas frågorna bort igen.
    // eslint-disable-next-line no-await-in-loop
    const made = toInsert.length ? await StudyItem.insertMany(toInsert.map(asCopy), { ordered: false }) : [];
    const idByRoot = new Map([...haveByRoot, ...made.map((d) => [String(d.copiedFrom), d._id])]);
    const questions = t.questions
      .map((q) => {
        const item = byId.get(String(q.item));
        return { item: item && idByRoot.get(rootOfDoc(item)), points: q.points, part: q.part || '' };
      })
      .filter((q) => q.item);
    try {
      if (!questions.length) throw new Error('no questions left');
      // eslint-disable-next-line no-await-in-loop
      await StudyTest.create({ ...contentOf(t), questions, unit: copy._id, user: me, copiedFrom: oid(rootOfDoc(t)), ...origin(t) });
      testCount += 1;
      itemCount += made.length;
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      if (made.length) await StudyItem.deleteMany({ _id: { $in: made.map((d) => d._id) } });
    }
  }

  if (pages.length) {
    await StudyPage.insertMany(pages.map((p, k) => ({
      ...contentOf(p), unit: copy._id, user: me, order: fresh ? (p.order || 0) : nextOrder + k, copiedFrom: oid(rootOfDoc(p)), ...origin(p)
    })), { ordered: false });
  }
  return { pages: pages.length, items: itemCount, tests: testCount };
}

/**
 * Ge `recipientId` en kopia av källan — eller, har hen redan en kopia av
 * samma original, det nya i den. Har hen originalet själv (skapat det, eller
 * följer det från före kopiorna) får hen inget.
 * Returnerar { unitId (det hen har), created, added } eller null (ingen plats).
 * Körs under mottagarens lås (giveCopies).
 */
async function giveCopy(sharerId, src, recipientId, blocked) {
  const { source } = src;
  const r = String(recipientId);
  const root = rootOf(source);
  const [original, existing] = await Promise.all([
    StudyUnit.findOne({ _id: oid(root), $or: [{ user: oid(r) }, { sharedWith: oid(r), archivedAt: null }] }, 'user').lean(),
    findCopy(r, root)
  ]);
  // Har hen originalet (skapat det, eller följer det från före kopiorna) får hen
  // inget — utom den som både följer det och redan har en kopia: hen byter till kopian.
  if (original && (String(original.user) === r || !existing)) return { unitId: String(original._id), created: false, added: 0 };
  // Den som följde ett original från före kopiorna och nu får (eller har) en
  // kopia slutar följa det — annars skulle originalet stå i vägen för allt nytt.
  const leaveOriginal = () => StudyUnit.updateOne(
    { _id: oid(root), sharedWith: oid(r) }, { $pull: { sharedWith: oid(r), sharedVia: { user: oid(r) } } }
  );
  const sum = (a) => a.pages + a.items + a.tests;
  if (existing) {
    await leaveOriginal();
    const added = await copyContent(src, existing, r, { blocked });
    // Hen har nu fått det av den här personen också (hens "har fått en kopia av dig").
    await StudyUnit.updateOne({ _id: existing._id }, { $addToSet: { 'copiedFrom.givers': oid(sharerId) } });
    return { unitId: String(existing._id), created: false, added: sum(added) };
  }
  // Titeln och beskrivningen följer med en ny kopia: har någon mottagaren har
  // en blockering med ändrat dem längs vägen kommer området inte fram alls.
  if (src.unitEditors.some((e) => e !== r && blocked(e, r))) return null;
  if (!(await hasRoomForUnit(r))) return null;
  // T.ex. hen följde ett original som sedan arkiverats (och som hen inte ser).
  await leaveOriginal();
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
      unit: source._id,
      root: oid(root),
      by: oid(sharerId),
      origin: oid(originOf(source)),
      givers: [oid(sharerId)],
      ...(src.unitEditors.length ? { editors: src.unitEditors.map(oid) } : {}),
      at: new Date()
    }
  });
  try {
    const added = await copyContent(src, copy, r, { fresh: true, blocked });
    return { unitId: String(copy._id), created: true, added: sum(added) };
  } catch (err) {
    // Ingen halv kopia blir kvar.
    await deleteStudyUnitsCascade([copy._id]);
    throw err;
  }
}

/** Får mottagaren plats med ett område till (tak per konto)? */
async function hasRoomForUnit(userId) {
  const [active, total] = await Promise.all([
    StudyUnit.countDocuments({ user: oid(userId), archivedAt: null }),
    StudyUnit.countDocuments({ user: oid(userId) })
  ]);
  return active < L.MAX_UNITS_PER_USER && total < L.MAX_UNITS_TOTAL;
}

/**
 * Ge var och en av `recipientIds` kopior av `units` (det nya, om hen redan har
 * en kopia). Den som har en blockering med originalets skapare hoppas tyst
 * över, och det någon man har en blockering med lagt till kommer inte med —
 * en blockering ska inte märkas. Går en kopia inte att göra hoppas den över
 * (loggas) och resten görs ändå.
 * Returnerar { created, updated, copies: Map(mottagare → [det hen har av varje område, i `units` ordning]) }.
 */
async function giveCopies(sharerId, units, recipientIds) {
  const recipients = [...new Set(recipientIds.map(String))];
  const sources = await Promise.all(units.map(loadSource));
  const blocked = await blockChecker([...recipients, ...units.map(originOf), ...sources.flatMap((s) => s.authors)]);
  let created = 0;
  let updated = 0;
  const copies = new Map();
  for (const r of recipients) {
    // eslint-disable-next-line no-await-in-loop
    await withUserLock(r, async () => {
      const mine = [];
      for (const [k, u] of units.entries()) {
        if (blocked(originOf(u), r)) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await giveCopy(sharerId, sources[k], r, blocked);
          if (!res) continue;
          mine.push(res.unitId);
          if (res.created) created += 1;
          else if (res.added) updated += 1;
        } catch (err) {
          console.error(`Plugga: could not copy ${u._id} for ${r}:`, err.message);
        }
      }
      copies.set(r, mine);
    });
  }
  return { created, updated, copies };
}

/**
 * Vilka har fått en kopia av området av `viewerId` (de har en kopia av samma
 * original, och `viewerId` har delat det med dem)? Den man har en blockering
 * med syns inte. [{ _id, username, avatar }], på namn.
 */
async function copiesGivenBy(unit, viewerId) {
  const copies = await StudyUnit.find(
    { 'copiedFrom.root': oid(rootOf(unit)), 'copiedFrom.givers': oid(viewerId), user: { $ne: oid(viewerId) } },
    'user'
  ).lean();
  const ids = [...new Set(copies.map((c) => String(c.user)))];
  const [names, blocked] = await Promise.all([profiles(ids), blockChecker([String(viewerId), ...ids])]);
  return ids
    .filter((id) => names.has(id) && !blocked(viewerId, id))
    .map((id) => ({ _id: id, username: names.get(id).username, avatar: names.get(id).avatar }))
    .sort((a, b) => a.username.localeCompare(b.username, 'sv'));
}

/**
 * Hur många `viewerId` gett en kopia av varje område: Map(områdets id → n).
 * Räknar som copiesGivenBy — utan dem man har en blockering med — så siffran
 * och listan aldrig skiljer sig (en skillnad skulle avslöja en blockering).
 */
async function copyCounts(units, viewerId) {
  if (!units.length) return new Map();
  const rows = await StudyUnit.aggregate([
    { $match: { 'copiedFrom.root': { $in: [...new Set(units.map(rootOf))].map(oid) }, 'copiedFrom.givers': oid(viewerId), user: { $ne: oid(viewerId) } } },
    { $group: { _id: '$copiedFrom.root', users: { $addToSet: '$user' } } }
  ]);
  const everyone = [...new Set(rows.flatMap((r) => r.users.map(String)))];
  const blocked = everyone.length ? await blockChecker([String(viewerId), ...everyone]) : () => false;
  const byRoot = new Map(rows.map((r) => [String(r._id), r.users.filter((id) => !blocked(viewerId, id)).length]));
  return new Map(units.map((u) => [String(u._id), byRoot.get(rootOf(u)) || 0]));
}

/**
 * Minns att ägaren tagit bort det här ur sin KOPIA (originalens id — även det
 * ägaren själv lagt till), så en ny delning inte lägger tillbaka det.
 */
async function markDropped(unit, docs) {
  if (!unit?.copiedFrom) return;
  const ids = (docs || []).filter(Boolean).map((d) => oid(rootOfDoc(d)));
  if (ids.length) await StudyUnit.updateOne({ _id: unit._id }, { $addToSet: { copyDropped: { $each: ids } } });
}

/** Ångrat: får komma med igen. */
async function unmarkDropped(unit, docs) {
  if (!unit?.copiedFrom) return;
  const ids = (docs || []).filter(Boolean).map((d) => oid(rootOfDoc(d)));
  if (ids.length) await StudyUnit.updateOne({ _id: unit._id }, { $pull: { copyDropped: { $in: ids } } });
}

module.exports = {
  MAX_COPY_PAIRS,
  rootOf,
  originOf,
  findCopy,
  loadSource,
  copyContent,
  giveCopy,
  giveCopies,
  hasRoomForUnit,
  copiesGivenBy,
  copyCounts,
  markDropped,
  unmarkDropped,
  markEdited
};
