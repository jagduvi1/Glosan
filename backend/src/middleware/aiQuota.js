const User = require('../models/User');
const { effectivePlan, monthKey } = require('../config/plans');

// Enforces the user's effective plan's AI-call quota. Mount AFTER requireAuth.
// On allow: req.user.plan / req.aiQuota are populated for the route to use.
// On deny: 402 (quota exceeded) with a friendly message + the quota numbers.
async function enforceAiQuota(req, res, next) {
  try {
    const user = await User.findById(req.user.id, 'plan trial aiUsage');
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const plan = effectivePlan(user);
    const limit = plan.aiCallsPerMonth;
    const currentMonth = monthKey();
    const usedThisMonth = user.aiUsage?.monthKey === currentMonth ? (user.aiUsage.count || 0) : 0;

    req.userPlan = plan;
    req.aiQuota = { limit, usedThisMonth, monthKey: currentMonth };

    if (limit !== null && usedThisMonth >= limit) {
      return res.status(402).json({
        error: `Du har använt alla ${limit} AI-anrop för ${currentMonth} på din ${plan.label}-plan. Uppgradera eller vänta till nästa månad.`,
        plan: plan.id,
        limit,
        used: usedThisMonth
      });
    }
    next();
  } catch (err) {
    console.error('AI quota check error:', err);
    return res.status(500).json({ error: 'Failed to check quota' });
  }
}

// Call after a successful AI route to count this call against the quota.
// Resets the counter when the monthKey changes.
async function incrementAiUsage(userId) {
  const currentMonth = monthKey();
  const user = await User.findById(userId);
  if (!user) return;
  if (!user.aiUsage || user.aiUsage.monthKey !== currentMonth) {
    user.aiUsage = { count: 1, monthKey: currentMonth };
  } else {
    user.aiUsage.count = (user.aiUsage.count || 0) + 1;
  }
  await user.save();
}

module.exports = { enforceAiQuota, incrementAiUsage };
