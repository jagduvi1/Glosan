const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const { PLANS, PLAN_IDS, isValidPlanId, effectivePlan, monthKey } = require('../config/plans');
const { FEATURES, FEATURE_KEYS, featuresForAll, featuresDisabled } = require('../config/features');
const { adminSetUsername } = require('../services/username');

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
    // Flaggor admin slagit på för just det här kontot (inte FEATURES_FOR_ALL).
    features: Array.isArray(user.features) ? user.features : [],
    // Flaggor som är AVSTÄNGDA för kontot — vinner över "på för alla" och inbjudningar.
    featureBlocks: Array.isArray(user.featureBlocks) ? user.featureBlocks : [],
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

// GET /api/admin/features — flagg-katalogen + vilka som är på för alla, så
// admin-UI:t kan rita en växel per flagga utan att hårdkoda dem.
router.get('/features', (req, res) => {
  const forAll = featuresForAll();
  const disabled = featuresDisabled();
  res.json({
    features: FEATURE_KEYS.map((key) => ({ key, ...FEATURES[key], forAll: forAll.includes(key), disabled: disabled.includes(key) }))
  });
});

// PATCH /api/admin/users/:id/username — byt namn åt någon (t.ex. ett elakt
// namn). Body: { username }. Samma regler som när man byter själv; kontot
// låses en vecka och det gamla namnet går inte att ångra till
// (services/username.js adminSetUsername).
router.patch('/users/:id/username', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  try {
    const r = await adminSetUsername(req.params.id, req.body?.username);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ user: shapeUserForAdmin(r.user.toObject()) });
  } catch (err) {
    console.error('Admin set username error:', err);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// PATCH /api/admin/users/:id/features — slå på/av en flagga för ett konto.
// Body: { feature: 'study', enabled: true }. Verkar direkt (requireFeature
// läser flaggan från databasen vid varje anrop).
router.patch('/users/:id/features', async (req, res) => {
  const { id } = req.params;
  const { feature, enabled } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (!FEATURE_KEYS.includes(feature) || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: `feature must be one of: ${FEATURE_KEYS.join(', ')}, and enabled a boolean` });
  }
  try {
    const user = await User.findByIdAndUpdate(
      id,
      // Av = blockerad: varken FEATURES_FOR_ALL eller en delning slår på den igen.
      enabled
        ? { $addToSet: { features: feature }, $pull: { featureBlocks: feature } }
        : { $pull: { features: feature }, $addToSet: { featureBlocks: feature } },
      { new: true }
    ).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: shapeUserForAdmin(user) });
  } catch (err) {
    console.error('Admin set feature error:', err);
    res.status(500).json({ error: 'Failed to update feature' });
  }
});

// GET /api/admin/users — paginerad lista, newest first.
// Query: ?offset=0&limit=50 (max 200). Returnerar { users, total, offset, limit }
// så UI kan göra paging utan att gissa.
router.get('/users', async (req, res) => {
  try {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const [users, total] = await Promise.all([
      User.find({}).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      User.countDocuments({})
    ]);
    res.json({
      users: users.map(shapeUserForAdmin),
      total,
      offset,
      limit
    });
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
