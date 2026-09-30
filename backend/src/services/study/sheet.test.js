/**
 * Övningsbladet: uppgiften som den skrivs ut och facit som hör till just den
 * utskriften — bokstäver för flerval, pappersordningen för ordna-frågor och
 * mallövningarnas variant (samma tal i uppgiften, facit och för AI:n).
 */
const { sheetItem, facitText, MAX_VARIANT } = require('./sheet');
const { instance } = require('./templates');

const unit = { _id: 'u1', code: 'MA2' };
const exercise = (number, answer, extra = {}) => ({ _id: `i${number}`, unit: 'u1', kind: 'exercise', number, level: 'E', prompt: `Uppgift ${number}`, answer, ...extra });
// Ett frö för Math.random-ersättaren: samma följd varje gång.
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('facit: one-choice and multi-choice with the letters on the sheet', () => {
  expect(facitText({ type: 'choice', choices: ['$x = 1$', '$x = 5$'], correctIndex: 1 })).toBe('B. $x = 5$');
  expect(facitText({ type: 'multi', choices: ['21', '23', '27', '29'], correctIndices: [3, 1] })).toBe('B. 23  ·  D. 29');
});

test('facit: numbers with a decimal comma and the unit, text, factors and open questions', () => {
  expect(facitText({ type: 'number', value: 3.5, unit: 'cm' })).toBe('3,5 cm');
  expect(facitText({ type: 'text', accepted: ['koefficient', 'koefficienten'] })).toBe('koefficient');
  expect(facitText({ type: 'self', modelAnswer: 'E: … C: … A: …' })).toBe('E: … C: … A: …');
  expect(facitText({ type: 'factors', factors: [2, 3, 3, 5] })).toMatch(/2.*3.*5/);
});

test('an order question is shuffled on paper, and its facit is in the letters of that shuffle', () => {
  const choices = ['1914', '1939', '1945', '1989'];
  for (let run = 0; run < 20; run++) {
    const out = sheetItem(exercise(3, { type: 'order', choices }), unit);
    expect([...out.items].sort()).toEqual([...choices].sort());
    const letters = out.facit.answer.split(' (')[0].split(' → ');
    // Bokstäverna i facit pekar ut alternativen i rätt ordning på pappret.
    expect(letters.map((l) => out.items[l.charCodeAt(0) - 65])).toEqual(choices);
  }
});

test('a card prints its front and has its back as facit', () => {
  const out = sheetItem({ _id: 'c1', unit: 'u1', kind: 'card', number: 1, prompt: 'Vad är 1 %?', back: 'En hundradel' }, unit);
  expect(out).toMatchObject({ code: 'MA2-1', kind: 'card', prompt: 'Vad är 1 %?', facit: { answer: 'En hundradel' } });
  expect(out.answerType).toBeUndefined();
});

describe('template exercises', () => {
  const tpl = exercise(7, { type: 'number', expr: 'a * b' }, {
    prompt: 'Beräkna {{a}} · {{b}}',
    solution: '{{a}} · {{b}} = {{ a * b }}',
    hints: ['Tänk på {{a}}-tabellen'],
    template: { vars: [{ name: 'a', int: [2, 9] }, { name: 'b', int: [2, 9] }], where: ['a != b'] }
  });

  test('get a short variant, and prompt, hints, facit and solution all use its numbers', () => {
    for (let run = 0; run < 30; run++) {
      const out = sheetItem(tpl, unit);
      expect(out.variant).toBeGreaterThanOrEqual(1);
      expect(out.variant).toBeLessThanOrEqual(MAX_VARIANT);
      const [, a, b] = out.prompt.match(/Beräkna (\d) · (\d)/);
      expect(out.hints[0]).toBe(`Tänk på ${a}-tabellen`);
      expect(out.facit.answer).toBe(String(a * b));
      expect(out.facit.solution).toBe(`${a} · ${b} = ${a * b}`);
    }
  });

  test('the same variant always gives the same numbers — what the AI gets from get_study_item', () => {
    const out = sheetItem(tpl, unit, { variant: 482 });
    expect(out.variant).toBe(482);
    expect(out.prompt).toBe(instance(tpl, 482).prompt);
    expect(out.facit.answer).toBe(String(instance(tpl, 482).answer.value));
    expect(sheetItem(tpl, unit, { rand: seq(0.4815) }).variant).toBe(1 + Math.floor(0.4815 * MAX_VARIANT));
  });

  test('a broken template is printed as it is, without a variant', () => {
    const broken = { ...tpl, template: { vars: [{ name: 'a', int: [1, 2] }], where: ['a > 5'] } };
    const out = sheetItem(broken, unit);
    expect(out.variant).toBeUndefined();
    expect(out.prompt).toBe('Beräkna {{a}} · {{b}}');
  });
});
