const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const XpEvent = require('../models/XpEvent');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const { localYmd, startOfLocalDay, addDays, periodRange } = require('../utils/localTime');

const router = express.Router();

router.use(requireAuth);

// GET /api/me/leaderboards/xp?period=month — XP-leaderboard mellan mig och
// mina kompisar för innevarande månad. Bara users med events tas med —
// inga events = inte med i listan.
router.get('/leaderboards/xp', async (req, res) => {
  const period = req.query.period === 'week' ? 'week' : 'month';
  try {
    const friendships = await Friendship.find({ user: req.user.id }, 'friend').lean();
    const friendIds = friendships.map((f) => f.friend);
    const allIds = [new mongoose.Types.ObjectId(req.user.id), ...friendIds];
    // I svensk tid: veckan = idag och sex dagar bakåt, månaden från den 1:a.
    const since = period === 'week'
      ? startOfLocalDay(addDays(localYmd(), -6))
      : periodRange('month').from;
    const agg = await XpEvent.aggregate([
      { $match: { user: { $in: allIds }, createdAt: { $gte: since } } },
      { $group: { _id: '$user', xp: { $sum: '$amount' } } }
    ]);
    const xpByUser = new Map(agg.map((r) => [r._id.toString(), r.xp]));
    const users = await User.find({ _id: { $in: allIds } }, 'username avatar').lean();
    const rows = users
      .map((u) => ({
        _id: u._id,
        username: u.username,
        avatar: u.avatar || { kind: 'initial', value: '' },
        isMe: u._id.toString() === req.user.id,
        xp: xpByUser.get(u._id.toString()) || 0
      }))
      .sort((a, b) => b.xp - a.xp);
    res.json({ period, since, leaderboard: rows });
  } catch (err) {
    console.error('XP leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
