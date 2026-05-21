const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const CoopStreak = require('../models/CoopStreak');
const Friendship = require('../models/Friendship');
const User = require('../models/User');

const router = express.Router();

router.use(requireAuth);

// GET /api/me/coop-streaks — alla par-streaks där jag är med, med data om
// den andra användaren så frontend kan rendera kort utan extra populate.
router.get('/coop-streaks', async (req, res) => {
  try {
    const streaks = await CoopStreak.find({ users: req.user.id })
      .populate('users', 'username avatar')
      .sort({ current: -1, longest: -1 })
      .lean();
    res.json({
      coopStreaks: streaks.map((s) => {
        const other = s.users.find((u) => u._id.toString() !== req.user.id);
        return {
          _id: s._id,
          other: other
            ? { _id: other._id, username: other.username, avatar: other.avatar }
            : null,
          current: s.current,
          longest: s.longest,
          lastBothActiveDay: s.lastBothActiveDay,
          createdAt: s.createdAt
        };
      })
    });
  } catch (err) {
    console.error('Coop-streak list error:', err);
    res.status(500).json({ error: 'Failed to fetch co-op streaks' });
  }
});

// POST /api/me/coop-streaks — body { friendId }. Skapa ett par-streak med
// en befintlig kompis. Idempotent: returnerar existerande paret om det finns.
router.post('/coop-streaks', async (req, res) => {
  const { friendId } = req.body;
  if (!mongoose.Types.ObjectId.isValid(friendId)) {
    return res.status(400).json({ error: 'friendId krävs' });
  }
  if (friendId === req.user.id) {
    return res.status(400).json({ error: 'Du kan inte starta en co-op-streak med dig själv.' });
  }
  try {
    // Verifiera att de är kompisar.
    const friendship = await Friendship.findOne({ user: req.user.id, friend: friendId }).lean();
    if (!friendship) {
      return res.status(400).json({ error: 'Du måste vara kompis för att starta en co-op-streak.' });
    }
    const pair = CoopStreak.sortedPair(req.user.id, friendId);
    let coop = await CoopStreak.findOne({ users: pair });
    if (!coop) {
      coop = await CoopStreak.create({ users: pair });
    }
    const other = await User.findById(friendId, 'username avatar').lean();
    res.status(201).json({
      coopStreak: {
        _id: coop._id,
        other: other ? { _id: other._id, username: other.username, avatar: other.avatar } : null,
        current: coop.current,
        longest: coop.longest,
        lastBothActiveDay: coop.lastBothActiveDay,
        createdAt: coop.createdAt
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Co-op-streak finns redan' });
    }
    console.error('Coop-streak create error:', err);
    res.status(500).json({ error: 'Failed to start co-op streak' });
  }
});

// DELETE /api/me/coop-streaks/:id — avsluta en streak. Endast en av de två
// medlemmarna får ta bort. Båda mister kortet i sina vyer.
router.delete('/coop-streaks/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const coop = await CoopStreak.findOne({ _id: id, users: req.user.id });
    if (!coop) return res.status(404).json({ error: 'Co-op streak not found' });
    await coop.deleteOne();
    res.json({ message: 'Co-op streak avslutad' });
  } catch (err) {
    console.error('Coop-streak delete error:', err);
    res.status(500).json({ error: 'Failed to delete co-op streak' });
  }
});

module.exports = router;
