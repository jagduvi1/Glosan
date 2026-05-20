const express = require('express');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');
const { unlockLevelFor } = require('../config/avatarUnlocks');

const router = express.Router();

router.use(requireAuth);

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / (24 * 60 * 60 * 1000));
}

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

function xpForLevel(level) {
  return Math.pow(level - 1, 2) * 50;
}

// GET /api/me/profile — aggregate profile + gamification stats
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const userLists = await GlosList.find({ user: req.user.id }, '_id').lean();
    const listIds = userLists.map((l) => l._id);

    const glosAgg = listIds.length > 0
      ? await Glos.aggregate([
          { $match: { list: { $in: listIds } } },
          {
            $group: {
              _id: null,
              totalGlosor: { $sum: 1 },
              totalCorrect: { $sum: { $ifNull: ['$stats.correct', 0] } },
              totalWrong: { $sum: { $ifNull: ['$stats.wrong', 0] } }
            }
          }
        ])
      : [];
    const { totalGlosor = 0, totalCorrect = 0, totalWrong = 0 } = glosAgg[0] || {};

    const level = levelFromXp(user.xp);
    const nextLevelAt = xpForLevel(level + 1);
    const thisLevelAt = xpForLevel(level);

    res.json({
      username: user.username,
      email: user.email,
      joinedAt: user.createdAt,
      avatar: {
        kind: user.avatar?.kind || 'initial',
        value: user.avatar?.value || ''
      },
      xp: user.xp,
      level,
      nextLevelAt,
      thisLevelAt,
      streak: {
        current: user.streak?.current ?? 0,
        longest: user.streak?.longest ?? 0,
        lastActiveDay: user.streak?.lastActiveDay ?? null
      },
      quizzesCompleted: user.quizzesCompleted ?? 0,
      perfectRounds: user.perfectRounds ?? 0,
      totalLists: listIds.length,
      totalGlosor,
      totalCorrect,
      totalWrong
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// POST /api/me/quiz-complete — award XP, tick streak, bump counters
// Body: { correct, total }
// Returns: { xpEarned, xp, level, streak, streakChange, perfectRounds, quizzesCompleted }
router.post('/quiz-complete', async (req, res) => {
  const correct = Number(req.body.correct);
  const total = Number(req.body.total);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
    return res.status(400).json({
      error: 'correct and total must be valid numbers with 0 <= correct <= total and total > 0'
    });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const xpEarned = correct * 10 + (correct === total ? 50 : 0);
    user.xp = (user.xp || 0) + xpEarned;
    user.quizzesCompleted = (user.quizzesCompleted || 0) + 1;
    if (correct === total) user.perfectRounds = (user.perfectRounds || 0) + 1;

    if (!user.streak) user.streak = { current: 0, longest: 0, lastActiveDay: null };
    const today = startOfDay(new Date());
    let streakChange = 'unchanged';
    if (!user.streak.lastActiveDay) {
      user.streak.current = 1;
      streakChange = 'started';
    } else {
      const gap = daysBetween(user.streak.lastActiveDay, today);
      if (gap <= 0) {
        // Already counted today (or clock skew) — no change
      } else if (gap === 1) {
        user.streak.current += 1;
        streakChange = 'continued';
      } else {
        user.streak.current = 1;
        streakChange = 'reset';
      }
    }
    if (user.streak.current > user.streak.longest) {
      user.streak.longest = user.streak.current;
    }
    user.streak.lastActiveDay = today;

    await user.save();

    res.json({
      xpEarned,
      xp: user.xp,
      level: levelFromXp(user.xp),
      streak: user.streak,
      streakChange,
      perfectRounds: user.perfectRounds,
      quizzesCompleted: user.quizzesCompleted
    });
  } catch (err) {
    console.error('Quiz-complete error:', err);
    res.status(500).json({ error: 'Failed to record quiz' });
  }
});

// PATCH /api/me/avatar — update the user's avatar
// Body: { kind: 'initial' | 'glo' | 'emoji', value?: string }
const ALLOWED_KINDS = ['initial', 'glo', 'emoji'];
const ALLOWED_GLO_MOODS = ['default', 'wink', 'sad'];

router.patch('/avatar', async (req, res) => {
  const { kind, value } = req.body;
  if (!ALLOWED_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'kind must be one of: initial, glo, emoji' });
  }
  if (kind === 'glo' && !ALLOWED_GLO_MOODS.includes(value)) {
    return res.status(400).json({ error: 'For kind=glo, value must be one of: default, wink, sad' });
  }
  if (kind === 'emoji' && (typeof value !== 'string' || value.length === 0 || value.length > 16)) {
    return res.status(400).json({ error: 'For kind=emoji, value must be a 1-16 character string' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const userLevel = levelFromXp(user.xp || 0);
    const requiredLevel = unlockLevelFor(kind, value);
    const cleanValue = kind === 'initial' ? '' : value;
    const isCurrent = user.avatar?.kind === kind && (user.avatar?.value || '') === cleanValue;

    if (!isCurrent && requiredLevel > userLevel) {
      return res.status(403).json({
        error: `Den här profilbilden låses upp på nivå ${requiredLevel}. Du är på nivå ${userLevel}.`
      });
    }

    user.avatar = { kind, value: cleanValue };
    await user.save();
    res.json({ avatar: user.avatar });
  } catch (err) {
    console.error('Avatar update error:', err);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

module.exports = router;
