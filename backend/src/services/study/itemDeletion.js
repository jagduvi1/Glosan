// Ta bort kort och övningar — med historik och ångra. Samma väg oavsett om
// eleven trycker på papperskorgen i appen eller AI:n tar bort via MCP, så
// historiken alltid är komplett. Allas progress på uppgiften försvinner (den
// finns inte längre), svarshistoriken (StudyAttempt) finns kvar.
const StudyItem = require('../../models/StudyItem');
const StudyItemState = require('../../models/StudyItemState');
const StudyFlag = require('../../models/StudyFlag');
const StudyTest = require('../../models/StudyTest');
const StudyItemDeletion = require('../../models/StudyItemDeletion');
const { isId, oid, itemCode } = require('./access');

/**
 * Ta bort uppgifter ur ett område. `items` = StudyItem-dokument (eller lean)
 * som tillhör `unit`. Returnerar koderna som togs bort.
 */
async function deleteItems(unit, items, { userId, via }) {
  if (!items.length) return [];
  const ids = items.map((i) => i._id);
  await StudyItemDeletion.insertMany(items.map((i) => {
    const doc = typeof i.toObject === 'function' ? i.toObject() : { ...i };
    delete doc._id;
    delete doc.__v;
    return {
      unit: unit._id,
      owner: unit.user,
      item: i._id,
      code: itemCode(unit, i),
      kind: i.kind,
      usage: i.usage || 'practice',
      snapshot: doc,
      deletedBy: userId,
      via
    };
  }));
  await StudyItem.deleteMany({ _id: { $in: ids } });
  await StudyItemState.deleteMany({ item: { $in: ids } });
  await StudyFlag.deleteMany({ item: { $in: ids } });
  // Provfrågor försvinner ur sina prov; ett prov utan frågor tas bort.
  await StudyTest.updateMany({ unit: unit._id }, { $pull: { questions: { item: { $in: ids } } } });
  await StudyTest.deleteMany({ unit: unit._id, questions: { $size: 0 } });
  return items.map((i) => itemCode(unit, i));
}

function deletionOut(d, userId) {
  const s = d.snapshot || {};
  return {
    id: String(d._id),
    code: d.code,
    kind: d.kind,
    usage: d.usage,
    prompt: s.prompt || '',
    back: d.kind === 'card' ? s.back || '' : undefined,
    level: s.level || null,
    via: d.via,
    byMe: String(d.deletedBy) === String(userId),
    deletedAt: d.deletedAt,
    restoredAt: d.restoredAt,
    // Provfrågor hör till ett prov och kan inte läggas tillbaka på egen hand.
    canRestore: !d.restoredAt && d.usage !== 'test'
  };
}

/** Borttaget i ett område, nyast först (bara för skaparen). */
async function listDeletions(unit, userId, limit = 100) {
  const rows = await StudyItemDeletion.find({ unit: unit._id }).sort({ deletedAt: -1 }).limit(limit).lean();
  return rows.map((d) => deletionOut(d, userId));
}

/**
 * Ångra: lägg tillbaka uppgiften med samma id och nummer (koden på ett gammalt
 * papper pekar alltså rätt igen). Progressen börjar om. Returnerar
 * { code } eller { error, status }.
 */
async function restoreDeletion(unit, deletionId) {
  if (!isId(deletionId)) return { error: 'Hittades inte.', status: 404 };
  const d = await StudyItemDeletion.findOne({ _id: oid(deletionId), unit: unit._id });
  if (!d) return { error: 'Hittades inte.', status: 404 };
  if (d.restoredAt) return { error: 'Den är redan återställd.', status: 409 };
  if (d.usage === 'test') return { error: 'Provfrågor kan inte återställas — be din AI göra om provet.', status: 409 };
  if (await StudyItem.exists({ $or: [{ _id: d.item }, { unit: unit._id, number: d.snapshot.number }] })) {
    return { error: 'Uppgiften finns redan.', status: 409 };
  }
  const item = new StudyItem({ ...d.snapshot, _id: d.item, unit: unit._id, user: unit.user });
  await item.save();
  d.restoredAt = new Date();
  await d.save();
  return { code: itemCode(unit, item) };
}

module.exports = { deleteItems, listDeletions, restoreDeletion };
