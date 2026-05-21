const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { loadEditableList, loadEditableGlos } = require('../middleware/ownership');
const Glos = require('../models/Glos');

const router = express.Router();

router.use(requireAuth);

router.post('/lists/:listId/glosor', loadEditableList('listId'), async (req, res) => {
  try {
    const { source, target, notes, exampleSentence, extra } = req.body;
    if (!source || !target) {
      return res.status(400).json({ error: 'source and target are required' });
    }

    const glos = await Glos.create({
      list: req.list._id,
      source,
      target,
      notes: notes || '',
      exampleSentence: exampleSentence || '',
      extra: extra === true
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

router.put('/glosor/:id', loadEditableGlos, async (req, res) => {
  try {
    const { source, target, notes, exampleSentence, stats, extra } = req.body;
    // Mottagare i edit-mode får ändra source/target/notes m.m. men inte
    // röra per-glos-mastery — det är ägarens data. Stats-uppdateringen
    // ignoreras tyst för icke-ägare så Quiz.jsx slipper specialfall.
    if (req.listIsOwner) {
      if (source !== undefined) req.glos.source = source;
      if (target !== undefined) req.glos.target = target;
      if (notes !== undefined) req.glos.notes = notes;
      if (exampleSentence !== undefined) req.glos.exampleSentence = exampleSentence;
      if (typeof extra === 'boolean') req.glos.extra = extra;
    } else {
      // Mottagare som vill redigera innehåll: tillåt source/target/notes,
      // men `extra` (homework vs extra) tillhör ägarens vy och låses.
      if (source !== undefined) req.glos.source = source;
      if (target !== undefined) req.glos.target = target;
      if (notes !== undefined) req.glos.notes = notes;
      if (exampleSentence !== undefined) req.glos.exampleSentence = exampleSentence;
    }

    if (stats && typeof stats === 'object' && req.listIsOwner) {
      // Stats är monotont ökande per quiz-svar — exakt +0 eller +1. Validera
      // delta så en manipulerad klient inte kan trissa upp värden eller
      // backdatera dem. Quiz/Galge/Ordfall skickar alltid current+0 eller +1.
      const validDelta = (next, current) =>
        typeof next === 'number' &&
        Number.isInteger(next) &&
        next >= 0 &&
        (next === current || next === current + 1);

      const curCorrect = req.glos.stats?.correct ?? 0;
      const curWrong = req.glos.stats?.wrong ?? 0;

      if (stats.correct !== undefined && !validDelta(stats.correct, curCorrect)) {
        return res.status(400).json({ error: 'stats.correct delta must be 0 or +1' });
      }
      if (stats.wrong !== undefined && !validDelta(stats.wrong, curWrong)) {
        return res.status(400).json({ error: 'stats.wrong delta must be 0 or +1' });
      }
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

router.delete('/glosor/:id', loadEditableGlos, async (req, res) => {
  try {
    await req.glos.deleteOne();
    res.json({ message: 'Glos deleted' });
  } catch (error) {
    console.error('Glos delete error:', error);
    res.status(500).json({ error: 'Failed to delete glos' });
  }
});

module.exports = router;
