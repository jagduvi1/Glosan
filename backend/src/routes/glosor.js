const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { loadOwnedList, loadOwnedGlos } = require('../middleware/ownership');
const Glos = require('../models/Glos');

const router = express.Router();

router.use(requireAuth);

router.post('/lists/:listId/glosor', loadOwnedList('listId'), async (req, res) => {
  try {
    const { source, target, notes, exampleSentence } = req.body;
    if (!source || !target) {
      return res.status(400).json({ error: 'source and target are required' });
    }

    const glos = await Glos.create({
      list: req.list._id,
      source,
      target,
      notes: notes || '',
      exampleSentence: exampleSentence || ''
    });
    res.status(201).json({ glos });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('Glos create error:', error);
    res.status(500).json({ error: 'Failed to create glos' });
  }
});

router.put('/glosor/:id', loadOwnedGlos, async (req, res) => {
  try {
    const { source, target, notes, exampleSentence, stats } = req.body;
    if (source !== undefined) req.glos.source = source;
    if (target !== undefined) req.glos.target = target;
    if (notes !== undefined) req.glos.notes = notes;
    if (exampleSentence !== undefined) req.glos.exampleSentence = exampleSentence;

    if (stats && typeof stats === 'object') {
      if (typeof stats.correct === 'number') req.glos.stats.correct = stats.correct;
      if (typeof stats.wrong === 'number') req.glos.stats.wrong = stats.wrong;
      req.glos.stats.lastReviewedAt = new Date();
    }

    await req.glos.save();
    res.json({ glos: req.glos });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('Glos update error:', error);
    res.status(500).json({ error: 'Failed to update glos' });
  }
});

router.delete('/glosor/:id', loadOwnedGlos, async (req, res) => {
  try {
    await req.glos.deleteOne();
    res.json({ message: 'Glos deleted' });
  } catch (error) {
    console.error('Glos delete error:', error);
    res.status(500).json({ error: 'Failed to delete glos' });
  }
});

module.exports = router;
