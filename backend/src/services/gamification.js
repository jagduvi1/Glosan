// Streak-, co-op-streak- och XP-logiken, delad mellan glos-quizzen
// (routes/me.js quiz-complete) och Plugga (services/study/practice.js), så att
// båda räknar dagar och streaks på exakt samma sätt.
const User = require('../models/User');
const CoopStreak = require('../models/CoopStreak');
const XpEvent = require('../models/XpEvent');
const { SUBJECT_KEYS } = require('../config/subjects');

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / (24 * 60 * 60 * 1000));
}

/**
 * Ticka dagens streak på ett User-dokument (muterar, sparar inte).
 * Returnerar 'started' | 'continued' | 'reset' | 'unchanged'.
 */
function tickStreak(user, today = startOfDay(new Date())) {
  if (!user.streak) user.streak = { current: 0, longest: 0, lastActiveDay: null };
  let streakChange = 'unchanged';
  if (!user.streak.lastActiveDay) {
    user.streak.current = 1;
    streakChange = 'started';
  } else {
    const gap = daysBetween(user.streak.lastActiveDay, today);
    if (gap <= 0) {
      // Redan räknad idag (eller klockskew) — ingen ändring
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
  return streakChange;
}

/**
 * Co-op-streaks: för varje par jag är med i tickas streaken upp om den andre
 * också är aktiv idag. Brytlogiken körs implicit — om lastBothActiveDay är
 * äldre än igår sätts current till 1 vid nästa gemensamma dag. Kör EFTER att
 * användarens egen streak sparats. Returnerar [{ otherId, current }].
 */
async function tickCoopStreaks(user, today = startOfDay(new Date())) {
  const coopUpdates = [];
  try {
    const coops = await CoopStreak.find({ users: user._id });
    if (coops.length === 0) return coopUpdates;
    const me = String(user._id);
    // Hämta alla "andra"-users i ett enda anrop (slipper N+1).
    const otherIds = coops.map((c) => c.users.find((u) => u.toString() !== me)).filter(Boolean);
    const others = await User.find({ _id: { $in: otherIds } }, 'streak').lean();
    const streakByUser = new Map(others.map((u) => [u._id.toString(), u.streak]));

    for (const coop of coops) {
      const otherId = coop.users.find((u) => u.toString() !== me);
      if (!otherId) continue;
      const otherStreak = streakByUser.get(otherId.toString());
      if (!otherStreak?.lastActiveDay) continue;
      const otherActiveToday = startOfDay(otherStreak.lastActiveDay).getTime() === today.getTime();
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
  return coopUpdates;
}

/** Summan av all Plugga-XP (User.subjectXp) — skild från språk-XP:n. */
function subjectXpTotal(user) {
  const map = user?.subjectXp && typeof user.subjectXp === 'object' ? user.subjectXp : {};
  return Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0);
}

/**
 * Plugga-aktivitet: ge XP (räknas i totalen, i topplistorna via XpEvent och
 * per ämne i User.subjectXp) och ticka streaks. `tickStreakToo` = false för
 * aktivitet som inte ska räknas som en pluggdag (t.ex. ett tomt pass).
 */
async function awardStudyActivity(userId, { xp, subject, tickStreakToo = true }) {
  const today = startOfDay(new Date());
  const amount = Math.max(0, Math.round(xp || 0));
  const key = SUBJECT_KEYS.includes(subject) ? subject : 'ovrigt';
  // $inc, inte läs–ändra–spara: två pass som avslutas samtidigt ska båda räknas.
  const user = amount > 0
    ? await User.findByIdAndUpdate(userId, { $inc: { xp: amount, [`subjectXp.${key}`]: amount } }, { new: true })
    : await User.findById(userId);
  if (!user) return null;
  let streakChange = 'unchanged';
  if (tickStreakToo) {
    streakChange = tickStreak(user, today);
    const { current, longest, lastActiveDay } = user.streak;
    await User.updateOne({ _id: user._id }, {
      $set: { 'streak.current': current, 'streak.longest': longest, 'streak.lastActiveDay': lastActiveDay }
    });
  }
  if (amount > 0) {
    await XpEvent.create({ user: user._id, amount, sourceLang: `study:${key}` })
      .catch((e) => console.error('XpEvent log error:', e.message));
  }
  const coopUpdates = tickStreakToo ? await tickCoopStreaks(user, today) : [];
  return { xpEarned: amount, xp: user.xp, streak: user.streak, streakChange, coopUpdates };
}

module.exports = { startOfDay, daysBetween, tickStreak, tickCoopStreaks, subjectXpTotal, awardStudyActivity };
