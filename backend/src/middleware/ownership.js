const mongoose = require('mongoose');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');

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

module.exports = { loadOwnedList, loadOwnedGlos };
