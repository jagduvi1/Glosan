// Plan tiers and per-plan AI-call quotas. Single source of truth for both
// quota enforcement (middleware/aiQuota.js) and admin / user UIs (which
// display the labels + limits).

const PLANS = {
  free: {
    id: 'free',
    label: 'Gratis',
    aiCallsPerMonth: 30,
    color: 'paper-deep'
  },
  basic: {
    id: 'basic',
    label: 'Bas',
    aiCallsPerMonth: 200,
    color: 'sky'
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    aiCallsPerMonth: null, // null = unlimited
    color: 'mustard'
  }
};

const PLAN_IDS = Object.keys(PLANS);
const DEFAULT_PLAN = 'free';

function isValidPlanId(id) {
  return PLAN_IDS.includes(id);
}

// Returns the plan the user is *effectively* on right now — their trial if
// it's still active, else their base plan. The user document is the source.
function effectivePlan(user) {
  if (user?.trial?.plan && user.trial.until && new Date(user.trial.until) > new Date()) {
    return PLANS[user.trial.plan] || PLANS[user.plan || DEFAULT_PLAN] || PLANS[DEFAULT_PLAN];
  }
  return PLANS[user?.plan || DEFAULT_PLAN] || PLANS[DEFAULT_PLAN];
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = { PLANS, PLAN_IDS, DEFAULT_PLAN, isValidPlanId, effectivePlan, monthKey };
