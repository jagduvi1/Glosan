const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const XpEvent = require('../models/XpEvent');
const Friendship = require('../models/Friendship');
const User = require('../models/User');

const router = express.Router();

router.use(requireAuth);

function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

// GET /api/me/leaderboards/xp?period=month — XP-leaderboard mellan mig och
// mina kompisar för innevarande månad. Bara users med events tas med —
// inga events = inte med i listan.
router.get('/leaderboards/xp', async (req, res) => {
  const period = req.query.period === 'week' ? 'week' : 'month';
  try {
    const friendships = await Friendship.find({ user: req.user.id }, 'friend').lean();
    const friendIds = friendships.map((f) => f.friend);
    const allIds = [new mongoose.Types.ObjectId(req.user.id), ...friendIds];
    let since;
    if (period === 'week') {
      since = new Date();
      since.setDate(since.getDate() - 6);
      since.setHours(0, 0, 0, 0);
    } else {
      since = startOfMonth();
    }
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
