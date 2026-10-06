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
const McpToken = require('../models/McpToken');
const OAuthAuthCode = require('../models/OAuthAuthCode');
const { exportStudyData, deleteStudyDataForUser } = require('../services/studyData');
const { sharerOf, profiles } = require('../services/sharedVia');
const { canEditWords } = require('../services/listSharing');
const {
  startOfDay, tickStreak, effectiveStreak, tickCoopStreaks, recordPracticeDay, subjectXpTotal
} = require('../services/gamification');
const { unlockLevelFor } = require('../config/avatarUnlocks');
const { PLANS, effectivePlan, monthKey } = require('../config/plans');

const router = express.Router();

router.use(requireAuth);

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
      // Som den är nu: 0 efter en missad dag, `today` = redan övat idag.
      streak: {
        ...effectiveStreak(user.streak),
        lastActiveDay: user.streak?.lastActiveDay ?? null
      },
      quizzesCompleted: user.quizzesCompleted ?? 0,
      perfectRounds: user.perfectRounds ?? 0,
      totalLists: listIds.length,
      totalGlosor,
      totalCorrect,
      totalWrong,
      referralCount: user.referralCount ?? 0,
      unlockedRewards: user.unlockedRewards || [],
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
      // user.xp was just incremented by xpEarned above; seed with the full
      // total — minus Plugga-XP, som hör till ett ämne och inte ett språk.
      existingLangXp[sourceLang] = Math.max(0, user.xp - subjectXpTotal(user));
    } else {
      existingLangXp[sourceLang] = (Number(existingLangXp[sourceLang]) || 0) + xpEarned;
    }
    user.languageXp = existingLangXp;
    user.markModified('languageXp');

    const today = startOfDay(new Date());
    const streakChange = tickStreak(user, today);

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

    // Co-op-streaks (services/gamification.js — delad med Plugga).
    const coopUpdates = await tickCoopStreaks(user, today);

    res.json({
      xpEarned,
      xp: user.xp,
      level: levelFromXp(user.xp),
      sourceLang,
      languageXp: buildLanguageBreakdown(user.languageXp),
      streak: { ...effectiveStreak(user.streak), lastActiveDay: user.streak.lastActiveDay },
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

// POST /api/me/practice-day — övning utan poäng (flashkort): räknas som en
// övningsdag för streaken och co-op-streaks, men ger ingen XP.
// Body: { listId } — en lista man har (egen eller delad med en).
router.post('/practice-day', async (req, res) => {
  const listId = req.body?.listId;
  if (!listId || !mongoose.Types.ObjectId.isValid(listId)) {
    return res.status(400).json({ error: 'listId is required' });
  }
  try {
    const list = await GlosList.exists({ _id: listId, $or: [{ user: req.user.id }, { sharedWith: req.user.id }] });
    if (!list) return res.status(404).json({ error: 'List not found' });
    const r = await recordPracticeDay(req.user.id);
    if (!r) return res.status(404).json({ error: 'User not found' });
    res.json(r);
  } catch (err) {
    console.error('Practice-day error:', err);
    res.status(500).json({ error: 'Failed to record practice' });
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
// nedladdning. Inkluderar profil, listor (egna + delade med mig), glosor,
// kompis-kopplingar, co-op-streaks, utmaningar (duels/goal/live), XP- och
// quiz-runda-historik, samt aktiva engångskoder.
router.get('/export', async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const Duel = require('../models/Duel');
    const InviteCode = require('../models/InviteCode');

    const [ownedLists, sharedLists] = await Promise.all([
      GlosList.find({ user: userId }, { sharedVia: 0 }).lean(),
      GlosList.find({ sharedWith: userId }).lean()
    ]);
    // Den som delade listan med mig — inte ägaren, om det var någon annan.
    const sharers = await profiles(sharedLists.map((l) => sharerOf(l, userId)));
    const ownedListIds = ownedLists.map((l) => l._id);
    const [
      glosor,
      friendships,
      coopStreaks,
      duels,
      xpEvents,
      quizRunEvents,
      inviteCodes,
      mcpTokens
    ] = await Promise.all([
      ownedListIds.length > 0 ? Glos.find({ list: { $in: ownedListIds } }).lean() : [],
      Friendship.find({ user: userId }).populate('friend', 'username').lean(),
      CoopStreak.find({ users: userId }).populate('users', 'username').lean(),
      Duel.find({ 'participants.user': userId })
        .populate('participants.user', 'username')
        .populate('list', 'title')
        .lean(),
      XpEvent.find({ user: userId }).lean(),
      QuizRunEvent.find({ user: userId }).populate('list', 'title').lean(),
      InviteCode.find({ user: userId }).lean(),
      McpToken.find({ user: userId }).lean()
    ]);
    const study = await exportStudyData(userId);
    const blockedUsers = await User.find({ _id: { $in: user.blocked || [] } }, 'username').lean();

    // Strip secrets — lösenord-hash och refresh-token-hash får aldrig läcka ut
    // ens till användaren själv.
    const { password, refreshTokenHash, refreshTokenFamily, blocked, ...safeUser } = user;

    res.setHeader('Content-Disposition', `attachment; filename="glosan-export-${user.username}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      schema: 'glosan-export-v2',
      user: { ...safeUser, blocked: blockedUsers.map((b) => ({ username: b.username })) },
      lists: {
        owned: ownedLists,
        sharedWithMe: sharedLists.map((l) => ({
          _id: l._id,
          title: l.title,
          sharedByUsername: sharers.get(sharerOf(l, userId))?.username || null,
          shareMode: canEditWords(l, userId) ? 'edit' : 'read',
          addedAt: l.createdAt
        }))
      },
      glosor,
      friendships: friendships.map((f) => ({
        friendUsername: f.friend?.username,
        addedAt: f.addedAt
      })),
      coopStreaks: coopStreaks.map((c) => ({
        otherUsername: c.users.find((u) => u._id.toString() !== req.user.id)?.username,
        current: c.current,
        longest: c.longest,
        lastBothActiveDay: c.lastBothActiveDay,
        createdAt: c.createdAt
      })),
      duels: duels.map((d) => ({
        _id: d._id,
        kind: d.kind,
        title: d.title,
        listTitle: d.list?.title,
        questionCount: d.questions?.length || 0,
        participants: d.participants.map((p) => ({
          username: p.user?.username,
          status: p.status,
          correct: p.correct,
          total: p.total,
          durationMs: p.durationMs,
          completedAt: p.completedAt
        })),
        createdAt: d.createdAt
      })),
      xpEvents,
      quizRunEvents: quizRunEvents.map((q) => ({
        listTitle: q.list?.title,
        correct: q.correct,
        total: q.total,
        ratio: q.ratio,
        createdAt: q.createdAt
      })),
      inviteCodes: inviteCodes.map((c) => ({
        code: c.code,
        expiresAt: c.expiresAt,
        usedAt: c.usedAt,
        createdAt: c.createdAt
      })),
      // Plugga: egna områden (med genomgångar och uppgifter), delade med mig,
      // mappar, pass, svar och progress.
      study,
      // Anslutna AI:er (MCP) — bara metadata, aldrig token-hashar.
      aiConnections: mcpTokens.map((t) => ({
        name: t.name,
        scopes: t.scopes,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        revokedAt: t.revokedAt
      }))
    });
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// DELETE /api/me — GDPR Art. 17: rätt att raderas. Hård delete på allt jag
// äger eller är knuten till. Cascading: User, GlosList, Glos, Friendship,
// CoopStreak, Duel, XpEvent, QuizRunEvent, InviteCode, McpToken,
// OAuthAuthCode och all Plugga-data (services/studyData.js). Pull också ut mig
// från andras GlosList.sharedWith så jag inte syns kvar i deras "delade
// med dig"-sektion.
//
// Vi försöker köra alla rensningarna i en MongoDB-transaktion för att
// garantera all-or-nothing. Om Mongo körs som standalone (utan replica
// set) stöds inte transactions och vi faller tillbaka på sekventiell
// körning med User.deleteOne sist — då är användaren "kvar" tills allt
// annat har rensats, så ett misslyckat anrop kan köras igen.
router.delete('/', async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const Duel = require('../models/Duel');
  const InviteCode = require('../models/InviteCode');

  async function runOps(session) {
    const opts = session ? { session } : {};
    const userLists = await GlosList.find({ user: userId }, '_id', opts).lean();
    const listIds = userLists.map((l) => l._id);

    if (listIds.length > 0) {
      await Glos.deleteMany({ list: { $in: listIds } }, opts);
      // QuizRunEvent kan referera mina listor; raderas via user-filter nedan,
      // men list-refen tas också bort när listan dör.
      await GlosList.deleteMany({ _id: { $in: listIds } }, opts);
    }
    // Pull ut mig från andras shared-listor (annars syns mitt user-ID
    // som dangling ref i deras "delade med dig"-sektion).
    await GlosList.updateMany(
      { sharedWith: userId },
      { $pull: { sharedWith: userId, sharedVia: { user: userId } } },
      opts
    );
    await Friendship.deleteMany({ $or: [{ user: userId }, { friend: userId }] }, opts);
    // Ur andras blockeringslistor (inga döda referenser).
    await User.updateMany({ blocked: userId }, { $pull: { blocked: userId } }, opts);
    await CoopStreak.deleteMany({ users: userId }, opts);
    // Duels jag deltagit i raderas i sin helhet — alternativ vore att
    // anonymisera mitt namn men för en hobby-app är hård delete cleaner.
    await Duel.deleteMany({ 'participants.user': userId }, opts);
    await XpEvent.deleteMany({ user: userId }, opts);
    await QuizRunEvent.deleteMany({ user: userId }, opts);
    await InviteCode.deleteMany({ user: userId }, opts);
    // Förbruka använda invites där jag var usedBy så de inte refererar mig
    await InviteCode.updateMany(
      { usedBy: userId },
      { $set: { usedBy: null } },
      opts
    );
    // AI-anslutningar (MCP) och ev. ej inlösta auth-koder. OAuthClient-raderna
    // är connector-metadata utan user-ref och lämnas kvar.
    await McpToken.deleteMany({ user: userId }, opts);
    await OAuthAuthCode.deleteMany({ user: userId }, opts);
    // Plugga: egna områden med allt innehåll + allas progress på dem, min
    // egen progress/historik/mappar, och mig ur andras delningar.
    await deleteStudyDataForUser(userId, opts);

    await User.deleteOne({ _id: userId }, opts);
  }

  let session = null;
  try {
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        await runOps(session);
      });
    } catch (txnErr) {
      const isStandalone = /transaction|replica\s*set|replSet/i.test(txnErr.message || '');
      if (isStandalone) {
        console.warn('[gdpr-delete] MongoDB i standalone-läge — kör sekventiell delete. För full atomicity, konfigurera Mongo som replica set.');
        await runOps(null);
      } else {
        throw txnErr;
      }
    } finally {
      if (session) await session.endSession();
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    res.json({ message: 'Konto raderat' });
  } catch (err) {
    console.error('Account delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
