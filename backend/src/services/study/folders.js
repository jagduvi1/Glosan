// Mappar i Plugga — elevens egna grupperingar av områden tvärs över ämnen och
// terminer ("Inför provet v. 42", "Allt jag ska repetera till NP"). En mapp
// kan innehålla både egna och delade områden. Mappen är bara ett urval: att
// radera en mapp rör aldrig områdena.
const StudyFolder = require('../../models/StudyFolder');
const StudyUnit = require('../../models/StudyUnit');
const { getSubject } = require('../../config/subjects');
const { readableFilter, isId, oid } = require('./access');
const { unitProgress, unitSummary } = require('./views');

const MAX_FOLDERS_PER_USER = 50;
const MAX_UNITS_PER_FOLDER = 200;
const COLORS = ['coral', 'leaf', 'sky', 'mustard', 'plum', 'berry'];

const cleanName = (name) => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 60) : '');
const cleanColor = (c) => (COLORS.includes(c) ? c : null);

/** De av `ids` som användaren får läsa (egna + delade), i given ordning. */
async function readableUnitIds(userId, ids) {
  const wanted = [...new Set((ids || []).map(String).filter(isId))];
  if (!wanted.length) return [];
  const found = await StudyUnit.find({ _id: { $in: wanted.map(oid) }, ...readableFilter(userId) }, '_id').lean();
  const ok = new Set(found.map((u) => String(u._id)));
  return wanted.filter((id) => ok.has(id));
}

async function loadFolder(userId, folderId) {
  if (!isId(folderId)) return null;
  return StudyFolder.findOne({ _id: oid(folderId), user: oid(userId) });
}

/** Mappens områden som användaren (fortfarande) kan läsa och som inte är arkiverade. */
async function folderUnits(userId, folder) {
  if (!folder.units.length) return [];
  const units = await StudyUnit.find({ _id: { $in: folder.units }, ...readableFilter(userId), archivedAt: null })
    .populate('user', 'username').lean();
  const order = new Map(folder.units.map((id, i) => [String(id), i]));
  return units.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
}

function folderOut(folder, units) {
  const subjects = [...new Set(units.map((u) => u.subject))];
  return {
    id: String(folder._id),
    name: folder.name,
    color: folder.color || null,
    unitIds: units.map((u) => String(u._id)),
    unitCount: units.length,
    emojis: subjects.map((s) => getSubject(s)?.emoji).filter(Boolean),
    updatedAt: folder.updatedAt
  };
}

/** Alla mina mappar, med de områden jag kan läsa. */
async function listFolders(userId) {
  const folders = await StudyFolder.find({ user: oid(userId) }).sort({ name: 1 }).lean();
  const allIds = [...new Set(folders.flatMap((f) => f.units.map(String)))];
  const readable = allIds.length
    ? await StudyUnit.find({ _id: { $in: allIds.map(oid) }, ...readableFilter(userId), archivedAt: null }, 'subject').lean()
    : [];
  const byId = new Map(readable.map((u) => [String(u._id), u]));
  return folders.map((f) => folderOut(f, f.units.map((id) => byId.get(String(id))).filter(Boolean)));
}

/** Mappsidan: mappen och dess områden med min progress. */
async function folderDetail(userId, folderId) {
  const folder = await loadFolder(userId, folderId);
  if (!folder) return null;
  const units = await folderUnits(userId, folder);
  const progress = await unitProgress(userId, units.map((u) => u._id));
  return {
    folder: folderOut(folder, units),
    units: units.map((u) => unitSummary(u, userId, progress.get(String(u._id)), u.user?.username))
  };
}

/** Returnerar { folder } eller { error, status }. */
async function createFolder(userId, { name, color, unitIds } = {}) {
  const n = cleanName(name);
  if (!n) return { error: 'Ge mappen ett namn.', status: 400 };
  const count = await StudyFolder.countDocuments({ user: oid(userId) });
  if (count >= MAX_FOLDERS_PER_USER) return { error: `Du har redan ${count} mappar — ta bort någon först.`, status: 409 };
  const ids = (await readableUnitIds(userId, unitIds)).slice(0, MAX_UNITS_PER_FOLDER);
  const folder = await StudyFolder.create({ user: userId, name: n, color: cleanColor(color), units: ids.map(oid) });
  const units = await folderUnits(userId, folder);
  return { folder: folderOut(folder, units) };
}

/** Byt namn/färg, lägg till eller ta bort områden. Returnerar { folder } eller { error, status }. */
async function updateFolder(userId, folderId, { name, color, addUnitIds, removeUnitIds } = {}) {
  const folder = await loadFolder(userId, folderId);
  if (!folder) return { error: 'Mappen hittades inte.', status: 404 };
  if (name !== undefined) {
    const n = cleanName(name);
    if (!n) return { error: 'Ge mappen ett namn.', status: 400 };
    folder.name = n;
  }
  if (color !== undefined) folder.color = cleanColor(color);
  const remove = new Set((removeUnitIds || []).map(String));
  let units = folder.units.map(String).filter((id) => !remove.has(id));
  const add = (await readableUnitIds(userId, addUnitIds)).filter((id) => !units.includes(id));
  units = [...units, ...add];
  if (units.length > MAX_UNITS_PER_FOLDER) return { error: `En mapp rymmer högst ${MAX_UNITS_PER_FOLDER} områden.`, status: 409 };
  folder.units = units.map(oid);
  await folder.save();
  return { folder: folderOut(folder, await folderUnits(userId, folder)) };
}

async function deleteFolder(userId, folderId) {
  if (!isId(folderId)) return false;
  const r = await StudyFolder.deleteOne({ _id: oid(folderId), user: oid(userId) });
  return r.deletedCount > 0;
}

module.exports = {
  MAX_FOLDERS_PER_USER, MAX_UNITS_PER_FOLDER, COLORS,
  readableUnitIds, loadFolder, listFolders, folderDetail, createFolder, updateFolder, deleteFolder
};
