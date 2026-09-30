/**
 * Funktionsflaggor i MCP: verktyg och prompts för en dold modul registreras
 * bara för användare som har flaggan, och instruktionerna nämner bara moduler
 * användaren har. Egen testfil — den registrerar ett låtsasverktyg, och
 * jest ger varje fil ett eget modulregister, så de riktiga registertesterna
 * påverkas inte.
 */
process.env.JWT_SECRET = 'test-secret';

const { registerTool, registerPrompt, toolsForScopes, promptsForScopes } = require('./registry');
const { FEATURE_SECTIONS, buildInstructions, INSTRUCTIONS } = require('./instructions');

registerTool({
  name: 'hidden_study_tool',
  title: 'Hidden',
  description: 'A tool that belongs to a module behind the study feature flag.',
  scope: 'read',
  feature: 'study',
  annotations: { readOnlyHint: true },
  handler: async () => ({ content: [] })
});
registerPrompt({
  name: 'hidden_study_prompt',
  title: 'Hidden prompt',
  description: 'A prompt behind the study flag.',
  scope: 'read',
  feature: 'study',
  handler: () => ({ messages: [] })
});
registerTool({
  name: 'visible_tool',
  title: 'Visible',
  description: 'A tool without any feature flag, visible to every read connection.',
  scope: 'read',
  annotations: { readOnlyHint: true },
  handler: async () => ({ content: [] })
});

test('tools behind a flag are not registered without it', () => {
  expect(toolsForScopes(['read']).map((t) => t.name)).toEqual(['visible_tool']);
  expect(toolsForScopes(['read'], ['study']).map((t) => t.name)).toEqual(['hidden_study_tool', 'visible_tool']);
});

test('the scope rule still applies on top of the flag', () => {
  expect(toolsForScopes([], ['study'])).toEqual([]);
});

test('prompts follow the same rule', () => {
  expect(promptsForScopes(['read']).map((p) => p.name)).toEqual([]);
  expect(promptsForScopes(['read'], ['study']).map((p) => p.name)).toEqual(['hidden_study_prompt']);
});

test('instructions only mention modules the user has', () => {
  FEATURE_SECTIONS.study = 'STUDY SECTION';
  expect(buildInstructions([])).toBe(INSTRUCTIONS);
  expect(buildInstructions(['study'])).toContain('STUDY SECTION');
  expect(buildInstructions([])).not.toContain('STUDY SECTION');
  delete FEATURE_SECTIONS.study;
});

test('an admin block wins over the account flag and FEATURES_FOR_ALL (audit)', () => {
  const { effectiveFeatures } = require('../config/features');
  const before = process.env.FEATURES_FOR_ALL;
  process.env.FEATURES_FOR_ALL = 'study';
  try {
    expect(effectiveFeatures({ features: [] })).toEqual(['study']);
    expect(effectiveFeatures({ features: ['study'], featureBlocks: ['study'] })).toEqual([]);
    expect(effectiveFeatures({ featureBlocks: ['study'] })).toEqual([]);
  } finally {
    if (before === undefined) delete process.env.FEATURES_FOR_ALL;
    else process.env.FEATURES_FOR_ALL = before;
  }
});

test('FEATURES_DISABLED switches a module off for everyone (audit)', () => {
  const { effectiveFeatures } = require('../config/features');
  const before = { all: process.env.FEATURES_FOR_ALL, off: process.env.FEATURES_DISABLED };
  process.env.FEATURES_FOR_ALL = 'study';
  process.env.FEATURES_DISABLED = 'study';
  try {
    expect(effectiveFeatures({ features: ['study'] })).toEqual([]);
  } finally {
    for (const [k, v] of [['FEATURES_FOR_ALL', before.all], ['FEATURES_DISABLED', before.off]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
