const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const { PLANS, PLAN_IDS, isValidPlanId, effectivePlan, monthKey } = require('../config/plans');

const router = express.Router();

router.use(requireAuth, requireAdmin);

// Maps a User doc into the shape the admin yta needs: who they are, which plan
// they're on, whether a trial is active, and how many AI calls they've burned
// this month. Used by GET /users (list) and after mutations to return fresh state.
function shapeUserForAdmin(user) {
  const currentMonth = monthKey();
  const usedThisMonth = user.aiUsage?.monthKey === currentMonth ? (user.aiUsage.count || 0) : 0;
  const plan = effectivePlan(user);
  const trialActive = !!(user.trial?.plan && user.trial.until && new Date(user.trial.until) > new Date());
  return {
    _id: user._id,
    username: user.username,
    email: user.email,
    roles: user.roles,
    plan: user.plan,
    effectivePlan: plan.id,
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
    createdAt: user.createdAt
  };
}

// GET /api/admin/plans — exposes the plan catalogue (id, label, quota) so the
// admin UI doesn't have to hard-code the same numbers as backend/config/plans.js.
router.get('/plans', (req, res) => {
  res.json({
    plans: PLAN_IDS.map((id) => ({
      id,
      label: PLANS[id].label,
      aiCallsPerMonth: PLANS[id].aiCallsPerMonth,
      color: PLANS[id].color
    }))
  });
});

// GET /api/admin/users — full list, newest first. Small app, no pagination yet.
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    res.json({ users: users.map(shapeUserForAdmin) });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// PATCH /api/admin/users/:id/plan — change a user's base plan (free/basic/premium).
// Does not touch their trial; the effective plan still wins until the trial expires.
router.patch('/users/:id/plan', async (req, res) => {
  const { id } = req.params;
  const { plan } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (!isValidPlanId(plan)) {
    return res.status(400).json({ error: `plan must be one of: ${PLAN_IDS.join(', ')}` });
  }
  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.plan = plan;
    await user.save();
    res.json({ user: shapeUserForAdmin(user) });
  } catch (err) {
    console.error('Admin set plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// POST /api/admin/users/:id/trial — grant a trial of a given plan for N days.
// Body: { plan, days }. Overwrites any existing trial. Admin-granted trials
// do not consume `hasUsedTrial` (that flag is for the self-service trial).
router.post('/users/:id/trial', async (req, res) => {
  const { id } = req.params;
  const { plan, days } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (!isValidPlanId(plan)) {
    return res.status(400).json({ error: `plan must be one of: ${PLAN_IDS.join(', ')}` });
  }
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1 || n > 365) {
    return res.status(400).json({ error: 'days must be a number between 1 and 365' });
  }
  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const until = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
    user.trial = { plan, until };
    await user.save();
    res.json({ user: shapeUserForAdmin(user) });
  } catch (err) {
    console.error('Admin grant trial error:', err);
    res.status(500).json({ error: 'Failed to grant trial' });
  }
});

// DELETE /api/admin/users/:id/trial — end an active trial early.
router.delete('/users/:id/trial', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.trial = { plan: null, until: null };
    await user.save();
    res.json({ user: shapeUserForAdmin(user) });
  } catch (err) {
    console.error('Admin clear trial error:', err);
    res.status(500).json({ error: 'Failed to clear trial' });
  }
});

// POST /api/admin/users/:id/reset-usage — manual AI-usage reset for the current
// month. Useful if support needs to grant goodwill calls without bumping the plan.
router.post('/users/:id/reset-usage', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.aiUsage = { count: 0, monthKey: monthKey() };
    await user.save();
    res.json({ user: shapeUserForAdmin(user) });
  } catch (err) {
    console.error('Admin reset usage error:', err);
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

module.exports = router;
