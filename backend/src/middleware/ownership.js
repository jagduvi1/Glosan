const mongoose = require('mongoose');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');
const Category = require('../models/Category');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Load a GlosList by param and verify req.user owns it.
// On success, attaches the list to req.list; on failure, sends 400/404 and
// short-circuits the chain. Pass the URL param name if it isn't "id"
// (e.g. POST /lists/:listId/glosor → loadOwnedList('listId')).
function loadOwnedList(paramName = 'id') {
  return async (req, res, next) => {
    const id = req.params[paramName];
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid list id' });
    }
    try {
      const list = await GlosList.findOne({ _id: id, user: req.user.id });
      if (!list) return res.status(404).json({ error: 'List not found' });
      req.list = list;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Same som loadOwnedList men accepterar även listor som någon annan delat
// med req.user (genom sharedWith). Sätter `req.list` plus `req.listIsOwner`
// så route-handlern kan välja mellan owner-only och read-only-beteende.
function loadReadableList(paramName = 'id') {
  return async (req, res, next) => {
    const id = req.params[paramName];
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid list id' });
    }
    try {
      const list = await GlosList.findOne({
        _id: id,
        $or: [{ user: req.user.id }, { sharedWith: req.user.id }]
      });
      if (!list) return res.status(404).json({ error: 'List not found' });
      req.list = list;
      req.listIsOwner = list.user.toString() === req.user.id;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Owner ELLER mottagare när list.shareMode === 'edit'. Används för glos-
// CRUD: lägg till, redigera och radera glosor. Owner får alltid; mottagare
// får om listan är i edit-mode.
function loadEditableList(paramName = 'id') {
  return async (req, res, next) => {
    const id = req.params[paramName];
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid list id' });
    }
    try {
      const list = await GlosList.findOne({
        _id: id,
        $or: [{ user: req.user.id }, { sharedWith: req.user.id }]
      });
      if (!list) return res.status(404).json({ error: 'List not found' });
      const isOwner = list.user.toString() === req.user.id;
      if (!isOwner && list.shareMode !== 'edit') {
        return res.status(403).json({ error: 'Den här listan är read-only för dig.' });
      }
      req.list = list;
      req.listIsOwner = isOwner;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Load a Glos by req.params.id and verify req.user owns the parent list.
// On success, attaches the glos to req.glos.
async function loadOwnedGlos(req, res, next) {
  const id = req.params.id;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid glos id' });
  }
  try {
    const glos = await Glos.findById(id).populate('list', 'user');
    if (!glos || !glos.list || glos.list.user.toString() !== req.user.id) {
      return res.status(404).json({ error: 'Glos not found' });
    }
    req.glos = glos;
    next();
  } catch (err) {
    next(err);
  }
}

// Owner of parent list, OR a sharedWith-user when list.shareMode === 'edit'.
// `req.listIsOwner` sätts så routes kan skydda stats-uppdatering (bara
// owner kan röra per-glos-mastery; mottagare som vill spara egna stats
// kopierar listan).
async function loadEditableGlos(req, res, next) {
  const id = req.params.id;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid glos id' });
  }
  try {
    const glos = await Glos.findById(id).populate('list', 'user sharedWith shareMode');
    if (!glos || !glos.list) {
      return res.status(404).json({ error: 'Glos not found' });
    }
    const isOwner = glos.list.user.toString() === req.user.id;
    const isShared = (glos.list.sharedWith || []).some((u) => u.toString() === req.user.id);
    if (!isOwner && !isShared) {
      return res.status(404).json({ error: 'Glos not found' });
    }
    if (!isOwner && glos.list.shareMode !== 'edit') {
      return res.status(403).json({ error: 'Den här listan är read-only för dig.' });
    }
    req.glos = glos;
    req.listIsOwner = isOwner;
    next();
  } catch (err) {
    next(err);
  }
}

// Load a Category by req.params.id and verify req.user owns it.
async function loadOwnedCategory(req, res, next) {
  const id = req.params.id;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid category id' });
  }
  try {
    const category = await Category.findOne({ _id: id, user: req.user.id });
    if (!category) return res.status(404).json({ error: 'Category not found' });
    req.category = category;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  loadOwnedList,
  loadReadableList,
  loadEditableList,
  loadOwnedGlos,
  loadEditableGlos,
  loadOwnedCategory
};
