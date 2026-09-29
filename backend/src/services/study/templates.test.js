/**
 * Mallövningar: nya tal varje gång, samma tal för samma frö, ett säkert
 * uttrycksspråk (ingen eval) och svensk talskrivning i texten.
 */
const { parse, calc, generate, render, instance, validateTemplate, formatSv } = require('./templates');

describe('expressions', () => {
  test('arithmetic, powers, precedence and functions', () => {
    expect(calc('2 + 3 * 4', {})).toBe(14);
    expect(calc('(2 + 3) * 4', {})).toBe(20);
    expect(calc('2 ^ 3 ^ 2', {})).toBe(512);
    expect(calc('-2 ^ 2', {})).toBe(-4);
    expect(calc('0.1 + 0.2', {})).toBe(0.3);
    expect(calc('7 · 6', {})).toBe(42);
    expect(calc('digit(27350, 3) * 10^3', {})).toBe(7000);
    expect(calc('digit(3.25, -1)', {})).toBe(2);
    expect(calc('round(2.748, 1)', {})).toBe(2.7);
    expect(calc('gcd(12, 18) + lcm(4, 6)', {})).toBe(18);
    expect(calc('posname(2)', {})).toBe('hundratal');
    expect(calc('n % 3 == 0 && n > 10', { n: 27 })).toBe(1);
  });

  test('anything else is refused, never evaluated', () => {
    for (const bad of ['process.exit()', 'constructor', '__proto__', 'toString()', 'constructor(1)', 'a[0]', '"x"', '2 +', 'foo(1)', '1; 2', 'x => x']) {
      expect(() => calc(bad, { a: 1 })).toThrow();
    }
    expect(() => calc('2 ^ 99', {})).toThrow(/exponents/);
    expect(() => parse('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/deeply/);
  });
});

describe('templates', () => {
  const template = {
    vars: [
      { name: 'n', int: [10000, 99999] },
      { name: 'k', int: [1, 4] },
      { name: 'd', calc: 'digit(n, k)' }
    ],
    where: ['d != 0']
  };
  const item = {
    prompt: 'Vilket värde har siffran {{d}} i talet {{n}}?',
    hints: ['Siffran står på {{ posname(k) }}.'],
    solution: '{{d}} står på {{ posname(k) }}, så värdet är $ {{ d * 10^k :tex}} $.',
    answer: { type: 'number', expr: 'd * 10^k' },
    template
  };

  test('the same seed gives the same numbers; different seeds vary', () => {
    expect(generate(template, 42)).toEqual(generate(template, 42));
    const seen = new Set(Array.from({ length: 20 }, (_, i) => generate(template, i + 1).n));
    expect(seen.size).toBeGreaterThan(15);
  });

  test('conditions are met, and the answer is computed per instance', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const inst = instance(item, seed);
      expect(inst.vars.d).not.toBe(0);
      expect(inst.answer.value).toBe(inst.vars.d * 10 ** inst.vars.k);
      expect(inst.prompt).not.toMatch(/\{\{/);
    }
  });

  test('numbers are written the Swedish way — also inside LaTeX', () => {
    expect(formatSv(27350)).toBe('27 350');
    expect(formatSv(3405)).toBe('3405');
    expect(formatSv(2.5)).toBe('2,5');
    expect(formatSv(-3)).toBe('−3');
    expect(formatSv(27350, true)).toBe('27\\,350');
    expect(formatSv(2.5, true)).toBe('2{,}5');
    expect(render('$ {{x:tex}} \\cdot 2 $ och {{x}}', { x: 1.5 })).toBe('$ 1{,}5 \\cdot 2 $ och 1,5');
  });

  test('checked when the AI creates it', () => {
    const okCheck = validateTemplate({ template, answerExpr: 'd * 10^k', texts: [item.prompt, item.solution] });
    expect(okCheck.samples).toHaveLength(2);
    expect(validateTemplate({ template, answerExpr: 'd * 10^', texts: [] }).error).toBeTruthy();
    expect(validateTemplate({ template: { vars: [{ name: 'n', int: [1, 5] }], where: ['n > 10'] }, answerExpr: 'n', texts: [] }).error).toMatch(/never met/);
    expect(validateTemplate({ template: { vars: [{ name: 'n', int: [1, 5], calc: 'n' }] }, answerExpr: 'n', texts: [] }).error).toMatch(/exactly one/);
    expect(validateTemplate({ template: { vars: [{ name: 'n', int: [1, 5] }] }, answerExpr: 'n / 0', texts: [] }).error).toMatch(/answer expression/);
    expect(validateTemplate({ template: { vars: [{ name: 'n', int: [1, 5] }] }, answerExpr: 'n', texts: ['{{ m }}'] }).error).toMatch(/unknown variable/);
    for (const name of ['constructor', 'toString', 'digit', '__proto__', '1n']) {
      expect(validateTemplate({ template: { vars: [{ name, int: [1, 5] }] }, answerExpr: '1', texts: [] }).error).toMatch(/variable name/);
    }
  });
});
