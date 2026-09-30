/**
 * Tester för MCP-registret: scope-filtret som gör skrivverktygen osynliga för
 * en läs-anslutning, och invarianter som resten av säkerhetsmodellen vilar på.
 */
process.env.JWT_SECRET = 'test-secret';

const { toolsForScopes, promptsForScopes, allTools, registerTool, scopeSatisfies } = require('./registry');
require('./tools');
require('./prompts');
const { splitDuplicates, pairKey } = require('./toolUtil');
const { budgetedHandler, MAX_CALLS_PER_REQUEST } = require('./server');
const mutationBudget = require('./mutationBudget');

describe('scope filtering', () => {
  test('a read-only connection never sees a write tool or prompt', () => {
    const names = toolsForScopes(['read']).map((t) => t.name);
    expect(names).toContain('list_lists');
    expect(names).toContain('get_list');
    expect(names).not.toContain('create_list');
    expect(names).not.toContain('delete_list');
    expect(toolsForScopes(['read']).every((t) => t.scope !== 'write')).toBe(true);
    expect(promptsForScopes(['read']).map((p) => p.name)).not.toContain('list_from_photo');
  });

  test('a read+write connection sees every tool it has the flags for', () => {
    expect(toolsForScopes(['read', 'write'], ['study'])).toHaveLength(allTools().length);
    // Plugga-verktygen finns inte alls utan flaggan 'study'.
    const withoutFlag = toolsForScopes(['read', 'write']).map((t) => t.name);
    expect(withoutFlag).toContain('create_list');
    expect(withoutFlag).not.toContain('create_study_unit');
  });

  test('public tools need no scope; others need the exact scope', () => {
    expect(scopeSatisfies([], 'public')).toBe(true);
    expect(scopeSatisfies(['read'], 'write')).toBe(false);
    expect(scopeSatisfies(undefined, 'read')).toBe(false);
  });

  test('duplicate tool names are a programming error', () => {
    expect(() => registerTool({ name: 'list_lists', scope: 'read', handler: () => {} })).toThrow(/duplicate/);
  });
});

describe('tool invariants', () => {
  // Skrivbudgeten i server.js slår till på readOnlyHint === false. Ett
  // skrivverktyg som glömmer hinten skulle alltså slippa budgeten.
  test('every write tool declares readOnlyHint: false, every other tool readOnlyHint: true', () => {
    for (const t of allTools()) {
      if (t.scope === 'write') expect([t.name, t.annotations.readOnlyHint]).toEqual([t.name, false]);
      else expect([t.name, t.annotations.readOnlyHint]).toEqual([t.name, true]);
    }
  });

  test('deletions — and overwrites of study content others may share — are flagged destructive', () => {
    const destructive = allTools().filter((t) => t.annotations.destructiveHint).map((t) => t.name).sort();
    expect(destructive).toEqual([
      'delete_list', 'delete_practice_test', 'delete_study_items', 'delete_study_page', 'delete_study_unit', 'delete_words',
      'update_study_item', 'update_study_page', 'update_study_unit'
    ]);
  });

  test('every tool has a description the model can choose by', () => {
    for (const t of allTools()) expect(t.description.length).toBeGreaterThan(40);
  });
});

describe('budgets', () => {
  beforeEach(() => mutationBudget._reset());

  const ctx = { user: { id: 'u1' }, scopes: ['read', 'write'] };
  const readTool = { name: 'r', annotations: { readOnlyHint: true }, handler: async () => 'ran' };
  const writeTool = { name: 'w', annotations: { readOnlyHint: false }, handler: async () => 'ran' };

  test('caps tool calls per request', async () => {
    const state = { calls: 0 };
    const h = budgetedHandler(readTool, ctx, state);
    for (let i = 0; i < MAX_CALLS_PER_REQUEST; i++) expect(await h({})).toBe('ran');
    const over = await h({});
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toMatch(/rate_limited/);
  });

  test('write tools spend the per-user mutation budget; reads do not', async () => {
    for (let i = 0; i < mutationBudget.MAX_WRITES; i++) expect(mutationBudget.takeMutationSlot('u1')).toBe(true);
    const w = await budgetedHandler(writeTool, ctx, { calls: 0 })({});
    expect(w.isError).toBe(true);
    expect(await budgetedHandler(readTool, ctx, { calls: 0 })({})).toBe('ran');
    // En annan användare har sin egen hink.
    expect(await budgetedHandler(writeTool, { ...ctx, user: { id: 'u2' } }, { calls: 0 })({})).toBe('ran');
  });

  test('the budget window slides', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < mutationBudget.MAX_WRITES; i++) mutationBudget.takeMutationSlot('u3', t0);
    expect(mutationBudget.takeMutationSlot('u3', t0 + 1000)).toBe(false);
    expect(mutationBudget.takeMutationSlot('u3', t0 + mutationBudget.WINDOW_MS + 1)).toBe(true);
  });

  test('a throwing handler becomes an orderly error envelope', async () => {
    const boom = { name: 'b', annotations: { readOnlyHint: true }, handler: async () => { throw new Error('db down'); } };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await budgetedHandler(boom, ctx, { calls: 0 })({});
    spy.mockRestore();
    expect(out.isError).toBe(true);
    expect(out.content[0].text).not.toMatch(/db down/);
  });
});

describe('duplicate detection for add_words / create_list', () => {
  test('pairKey ignores case and surrounding/inner whitespace', () => {
    expect(pairKey(' Huset ', 'the  house')).toBe(pairKey('huset', 'The house'));
    expect(pairKey('ÅR', 'year')).toBe(pairKey('år', 'year'));
  });

  test('skips pairs already on the list and repeats within the batch', () => {
    const existing = [{ source: 'hund', target: 'dog' }];
    const incoming = [
      { source: 'Hund', target: 'Dog' },
      { source: 'katt', target: 'cat' },
      { source: 'katt', target: 'cat' },
      { source: 'katt', target: 'kitten' }
    ];
    const { fresh, duplicates } = splitDuplicates(incoming, existing);
    expect(fresh.map((w) => w.target)).toEqual(['cat', 'kitten']);
    expect(duplicates).toHaveLength(2);
  });
});

describe('daily write volume (audit)', () => {
  beforeEach(() => mutationBudget._reset());

  test('write tools spend a per-user byte budget per day', async () => {
    const ctx = { user: { id: 'vol1' }, scopes: ['read', 'write'] };
    const writeTool = { name: 'w', annotations: { readOnlyHint: false }, handler: async () => 'ran' };
    expect(mutationBudget.takeWriteBytes('vol1', mutationBudget.MAX_WRITE_BYTES_PER_DAY - 10)).toBe(true);
    const over = await budgetedHandler(writeTool, ctx, { calls: 0 })({ words: 'x'.repeat(100) });
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toMatch(/daily limit/);
    // En annan användare, och nästa dygn, har sin egen budget.
    expect(await budgetedHandler(writeTool, { ...ctx, user: { id: 'vol2' } }, { calls: 0 })({ words: 'x' })).toBe('ran');
    const t0 = 5_000_000;
    expect(mutationBudget.takeWriteBytes('vol3', mutationBudget.MAX_WRITE_BYTES_PER_DAY, t0)).toBe(true);
    expect(mutationBudget.takeWriteBytes('vol3', 1, t0 + 1000)).toBe(false);
    expect(mutationBudget.takeWriteBytes('vol3', 1, t0 + 24 * 60 * 60 * 1000 + 1)).toBe(true);
  });
});
