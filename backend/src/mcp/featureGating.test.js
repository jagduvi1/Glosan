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
