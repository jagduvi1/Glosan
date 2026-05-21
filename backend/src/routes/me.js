const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');
const Friendship = require('../models/Friendship');
const CoopStreak = require('../models/CoopStreak');
const XpEvent = require('../models/XpEvent');
const QuizRunEvent = require('../models/QuizRunEvent');
const { unlockLevelFor } = require('../config/avatarUnlocks');
const { PLANS, effectivePlan, monthKey } = require('../config/plans');

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

// XP curve: level N requires (N-1)² × 100 XP.
// So L2=100, L3=400, L5=1600, L7=3600, L10=8100, L15=19600, L20=36100, L30=84100.
// The multiplier was 50 originally; doubling it stretches the late game so the
// new high-level avatar unlocks (L7+) feel earned.
function levelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function xpForLevel(level) {
  return Math.pow(level - 1, 2) * 100;
}

// Turn the raw per-language XP map into a response-ready breakdown with derived
// level + this/next level XP markers, so the frontend can draw a progress bar.
function buildLanguageBreakdown(languageXp) {
  const map = languageXp && typeof languageXp === 'object' ? languageXp : {};
  const out = {};
  for (const [lang, raw] of Object.entries(map)) {
    const xp = Number(raw) || 0;
    if (xp < 0) continue;
    const level = levelFromXp(xp);
    out[lang] = {
      xp,
      level,
      thisLevelAt: xpForLevel(level),
      nextLevelAt: xpForLevel(level + 1)
    };
  }
  return out;
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

    // Slim plan summary so the Layout pill can read kvot live via the
    // gamification context; full plan catalogue stays on /api/me/plan.
    const plan = effectivePlan(user);
    const currentMonth = monthKey();
    const usedThisMonth = user.aiUsage?.monthKey === currentMonth ? (user.aiUsage.count || 0) : 0;

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
      languageXp: buildLanguageBreakdown(user.languageXp),
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
      totalWrong,
      plan: {
        id: plan.id,
        label: plan.label,
        color: plan.color
      },
      aiUsage: {
        used: usedThisMonth,
        limit: plan.aiCallsPerMonth,
        monthKey: currentMonth
      }
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// POST /api/me/quiz-complete — award XP, tick streak, bump counters
// Body: { correct, total, listId }
// Returns: { xpEarned, xp, level, languageXp, streak, streakChange, ... }
router.post('/quiz-complete', async (req, res) => {
  const correct = Number(req.body.correct);
  const total = Number(req.body.total);
  const listId = req.body.listId;
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
    return res.status(400).json({
      error: 'correct and total must be valid numbers with 0 <= correct <= total and total > 0'
    });
  }
  if (!listId || !mongoose.Types.ObjectId.isValid(listId)) {
    return res.status(400).json({ error: 'listId is required' });
  }

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Tillåt även delade listor — quiz-XP räknas till mottagaren, inte ägaren.
    const list = await GlosList.findOne({
      _id: listId,
      $or: [{ user: req.user.id }, { sharedWith: req.user.id }]
    }, 'sourceLang').lean();
    if (!list) return res.status(404).json({ error: 'List not found' });
    const sourceLang = list.sourceLang || 'unknown';

    const xpEarned = correct * 10 + (correct === total ? 50 : 0);
    user.xp = (user.xp || 0) + xpEarned;
    user.quizzesCompleted = (user.quizzesCompleted || 0) + 1;
    if (correct === total) user.perfectRounds = (user.perfectRounds || 0) + 1;

    // Per-language XP allocation. First-ever per-lang write also absorbs the
    // legacy `user.xp` total so users from before this change don't lose
    // their progress on the language they're practicing now.
    const existingLangXp = user.languageXp && typeof user.languageXp === 'object' ? { ...user.languageXp } : {};
    const hasAnyLanguageXp = Object.keys(existingLangXp).length > 0;
    if (!hasAnyLanguageXp) {
      // user.xp was just incremented by xpEarned above; seed with the full total.
      existingLangXp[sourceLang] = user.xp;
    } else {
      existingLangXp[sourceLang] = (Number(existingLangXp[sourceLang]) || 0) + xpEarned;
    }
    user.languageXp = existingLangXp;
    user.markModified('languageXp');

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

    // XP-event-logg för "Månadens XP"-leaderboard m.fl. tidsbaserade vyer.
    // Insertas asynkront utan att blockera svaret — om det misslyckas är
    // det bara en kosmetisk siffra som blir fel.
    if (xpEarned > 0) {
      XpEvent.create({ user: user._id, amount: xpEarned, sourceLang })
        .catch((e) => console.error('XpEvent log error:', e.message));
    }

    // Per-runda-logg för "veckans rekord per lista" — aggregeras av
    // /api/lists/:id/weekly-records mellan ägare + mottagare av delade
    // listor. Async så svaret inte blockas.
    QuizRunEvent.create({
      user: user._id,
      list: listId,
      correct,
      total,
      ratio: total > 0 ? correct / total : 0
    }).catch((e) => console.error('QuizRunEvent log error:', e.message));

    // Co-op-streaks: för varje par jag är med i, tickas streaken upp om
    // den andre också är aktiv idag. Brytlogiken körs implicit — om
    // lastBothActiveDay är äldre än igår sätts current till 1 vid nästa
    // gemensamma dag.
    let coopUpdates = [];
    try {
      const coops = await CoopStreak.find({ users: user._id });
      for (const coop of coops) {
        const otherId = coop.users.find((u) => u.toString() !== req.user.id);
        if (!otherId) continue;
        const other = await User.findById(otherId, 'streak').lean();
        if (!other?.streak?.lastActiveDay) continue;
        const otherActiveToday = startOfDay(other.streak.lastActiveDay).getTime() === today.getTime();
        if (!otherActiveToday) continue;
        if (coop.lastBothActiveDay && startOfDay(coop.lastBothActiveDay).getTime() === today.getTime()) {
          continue; // redan räknad idag
        }
        if (coop.lastBothActiveDay && daysBetween(coop.lastBothActiveDay, today) === 1) {
          coop.current += 1;
        } else {
          coop.current = 1;
        }
        if (coop.current > coop.longest) coop.longest = coop.current;
        coop.lastBothActiveDay = today;
        await coop.save();
        coopUpdates.push({ otherId: String(otherId), current: coop.current });
      }
    } catch (e) {
      console.error('Co-op streak update error:', e.message);
    }

    res.json({
      xpEarned,
      xp: user.xp,
      level: levelFromXp(user.xp),
      sourceLang,
      languageXp: buildLanguageBreakdown(user.languageXp),
      streak: user.streak,
      streakChange,
      perfectRounds: user.perfectRounds,
      quizzesCompleted: user.quizzesCompleted,
      coopUpdates
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

// GET /api/me/plan — current plan, effective plan, trial status, and this
// month's AI usage. Powers the plan card on the Profile page.
router.get('/plan', async (req, res) => {
  try {
    const user = await User.findById(req.user.id, 'plan trial hasUsedTrial aiUsage');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const plan = effectivePlan(user);
    const currentMonth = monthKey();
    const usedThisMonth = user.aiUsage?.monthKey === currentMonth ? (user.aiUsage.count || 0) : 0;
    const trialActive = !!(user.trial?.plan && user.trial.until && new Date(user.trial.until) > new Date());

    res.json({
      plan: user.plan,
      effectivePlan: {
        id: plan.id,
        label: plan.label,
        aiCallsPerMonth: plan.aiCallsPerMonth,
        color: plan.color
      },
      trial: {
        plan: user.trial?.plan || null,
        until: user.trial?.until || null,
        active: trialActive
      },
      hasUsedTrial: !!user.hasUsedTrial,
      aiUsage: {
        used: usedThisMonth,
        limit: plan.aiCallsPerMonth,
        monthKey: currentMonth
      },
      plans: Object.values(PLANS).map((p) => ({
        id: p.id,
        label: p.label,
        aiCallsPerMonth: p.aiCallsPerMonth,
        color: p.color
      }))
    });
  } catch (err) {
    console.error('Get plan error:', err);
    res.status(500).json({ error: 'Failed to load plan' });
  }
});

// POST /api/me/trial — one-shot self-service trial of premium for 7 days.
// `hasUsedTrial` is set so the user can't trigger it twice. Admin-granted
// trials don't burn this flag, so support can still gift one later.
router.post('/trial', async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.hasUsedTrial) {
      return res.status(400).json({ error: 'Du har redan använt din gratis trial. Kontakta Johan om du vill prova igen.' });
    }
    const trialActive = !!(user.trial?.plan && user.trial.until && new Date(user.trial.until) > new Date());
    if (trialActive) {
      return res.status(400).json({ error: 'Du har redan en aktiv trial.' });
    }

    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    user.trial = { plan: 'premium', until };
    user.hasUsedTrial = true;
    await user.save();

    const plan = effectivePlan(user);
    res.json({
      trial: { plan: user.trial.plan, until: user.trial.until, active: true },
      effectivePlan: { id: plan.id, label: plan.label, aiCallsPerMonth: plan.aiCallsPerMonth, color: plan.color },
      hasUsedTrial: true
    });
  } catch (err) {
    console.error('Start trial error:', err);
    res.status(500).json({ error: 'Failed to start trial' });
  }
});

// GET /api/me/export — GDPR Art. 20: portabel kopia av all användardata.
// Returnerar en JSON-blob som frontend skickar vidare till browsern som
// nedladdning. Inkluderar profil, listor, glosor och kompis-kopplingar.
router.get('/export', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const lists = await GlosList.find({ user: req.user.id }).lean();
    const listIds = lists.map((l) => l._id);
    const glosor = listIds.length > 0
      ? await Glos.find({ list: { $in: listIds } }).lean()
      : [];
    const friendships = await Friendship.find({ user: req.user.id })
      .populate('friend', 'username friendCode')
      .lean();

    // Strip secrets — lösenord-hash och refresh-token-hash får aldrig läcka ut
    // ens till användaren själv.
    const { password, refreshTokenHash, ...safeUser } = user;

    res.setHeader('Content-Disposition', `attachment; filename="glosan-export-${user.username}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      schema: 'glosan-export-v1',
      user: safeUser,
      lists,
      glosor,
      friendships: friendships.map((f) => ({
        friendUsername: f.friend?.username,
        friendCode: f.friend?.friendCode,
        addedAt: f.addedAt
      }))
    });
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// DELETE /api/me — GDPR Art. 17: rätt att raderas. Tar bort kontot, alla
// listor + glosor och båda hållen av vänskapsrelationerna. Refresh-cookien
// rensas. Hård delete — vi behåller inget för "soft delete" eftersom appen
// inte har någon legal grund för det.
router.delete('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const userLists = await GlosList.find({ user: userId }, '_id').lean();
    const listIds = userLists.map((l) => l._id);

    if (listIds.length > 0) {
      await Glos.deleteMany({ list: { $in: listIds } });
      await GlosList.deleteMany({ _id: { $in: listIds } });
    }
    await Friendship.deleteMany({ $or: [{ user: userId }, { friend: userId }] });
    await User.deleteOne({ _id: userId });

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    res.json({ message: 'Konto raderat' });
  } catch (err) {
    console.error('Account delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
