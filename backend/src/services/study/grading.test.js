/**
 * Rättningsmotorn i Plugga. Den avgör om en elev fick rätt — ett fel här
 * betyder att rätt svar underkänns (frustrerande) eller fel svar godkänns
 * (man lär sig fel). Därför pinnas svenska skrivsätt noga.
 */
const {
  parseNumber, formatNumber, gradeNumber, gradeChoice, gradeText, gradeAnswer, levenshtein
} = require('./grading');

describe('parseNumber — as a Swedish student writes numbers', () => {
  test.each([
    ['3,5', 3.5, ''],
    ['3.5', 3.5, ''],
    ['  42 ', 42, ''],
    ['−2', -2, ''],
    ['–2,25', -2.25, ''],
    ['-2', -2, ''],
    ['7/2', 3.5, ''],
    ['3 1/2', 3.5, ''],
    ['-3 1/2', -3.5, ''],
    ['1 000', 1000, ''],
    ['12 500 000', 12500000, ''],
    ['1 000', 1000, ''],
    [',5', 0.5, ''],
    ['35 %', 35, '%'],
    ['35%', 35, '%'],
    ['12 cm', 12, 'cm'],
    ['12cm', 12, 'cm'],
    ['5 m/s', 5, 'm/s'],
    ['3,5 km / h', 3.5, 'km/h'],
    ['20 m²', 20, 'm^2'],
    ['x = 4', 4, ''],
    ['x=-4', -4, ''],
    ['≈ 3,14', 3.14, ''],
    ['ca 3,14', 3.14, '']
  ])('%p → %p %p', (input, value, unit) => {
    const r = parseNumber(input);
    expect(r).not.toBeNull();
    expect(r.value).toBeCloseTo(value, 10);
    expect(r.unit).toBe(unit);
  });

  test.each(['', 'hej', '3 eller 4', '3 4', '1/0', 'x', '2^3', null, undefined, '12'.repeat(40)])('rejects %p', (input) => {
    expect(parseNumber(input)).toBeNull();
  });

  test('a comma is always the decimal separator (Swedish)', () => {
    expect(parseNumber('1,000').value).toBe(1);
  });
});

describe('formatNumber', () => {
  test('Swedish decimal comma and minus sign, no float noise', () => {
    expect(formatNumber(3.5)).toBe('3,5');
    expect(formatNumber(-2)).toBe('−2');
    expect(formatNumber(0.1 + 0.2)).toBe('0,3');
    expect(formatNumber(1 / 3)).toBe('0,333333');
    expect(formatNumber(12)).toBe('12');
  });
});

describe('gradeNumber', () => {
  test('exact answers', () => {
    expect(gradeNumber('4', { value: 4 }).result).toBe('correct');
    expect(gradeNumber('4,0', { value: 4 }).result).toBe('correct');
    expect(gradeNumber('8/2', { value: 4 }).result).toBe('correct');
    expect(gradeNumber('5', { value: 4 })).toMatchObject({ result: 'wrong', expected: '4' });
  });

  test('tolerance for rounded answers', () => {
    const spec = { value: 3.14, tolerance: 0.005 };
    expect(gradeNumber('3,14', spec).result).toBe('correct');
    expect(gradeNumber('3,142', spec).result).toBe('correct');
    expect(gradeNumber('3,2', spec).result).toBe('wrong');
    expect(gradeNumber('1/3', { value: 0.3333, tolerance: 0.001 }).result).toBe('correct');
  });

  test('the tolerance edge holds for large numbers too (audit)', () => {
    // 123456,75 − 123456,7 = 0,05000000000291 i flyttal.
    expect(gradeNumber('123456,75', { value: 123456.7, tolerance: 0.05 }).result).toBe('correct');
    expect(gradeNumber('123456,76', { value: 123456.7, tolerance: 0.05 }).result).toBe('wrong');
    expect(gradeNumber('1000000,1', { value: 1000000 }).result).toBe('wrong');
  });

  test('units: a missing unit is forgiven with a reminder, a wrong unit is wrong', () => {
    const spec = { value: 12, unit: 'cm' };
    expect(gradeNumber('12 cm', spec)).toMatchObject({ result: 'correct', expected: '12 cm' });
    expect(gradeNumber('12', spec)).toMatchObject({ result: 'correct', note: expect.stringContaining('enheten') });
    expect(gradeNumber('12 m', spec)).toMatchObject({ result: 'wrong', note: expect.stringContaining('cm') });
    expect(gradeNumber('25 %', { value: 25, unit: '%' }).result).toBe('correct');
  });

  test('unreadable input is not counted as wrong', () => {
    expect(gradeNumber('fyra', { value: 4 })).toMatchObject({ invalid: true, message: expect.any(String) });
    expect(gradeNumber('', { value: 4 }).invalid).toBe(true);
  });
});

describe('gradeChoice', () => {
  const spec = { choices: ['2', '3', '4'], correctIndex: 2 };
  test('index answers', () => {
    expect(gradeChoice(2, spec)).toEqual({ result: 'correct', expected: '4' });
    expect(gradeChoice('0', spec)).toEqual({ result: 'wrong', expected: '4' });
    expect(gradeChoice(7, spec).invalid).toBe(true);
    expect(gradeChoice('x', spec).invalid).toBe(true);
  });

  test('a blank answer is not the first choice (audit)', () => {
    expect(gradeChoice('', spec).invalid).toBe(true);
    expect(gradeChoice('  ', spec).invalid).toBe(true);
    expect(gradeChoice(undefined, spec).invalid).toBe(true);
    expect(gradeChoice(null, spec).invalid).toBe(true);
  });
});

describe('gradeText', () => {
  const spec = { accepted: ['fotosyntes', 'fotosyntesen'] };
  test('case, spacing and trailing punctuation do not matter', () => {
    expect(gradeText('Fotosyntes', spec).result).toBe('correct');
    expect(gradeText('  fotosyntesen. ', spec).result).toBe('correct');
  });

  test('a small typo inside a longer word passes, with the right spelling shown', () => {
    expect(gradeText('fotosymtes', spec)).toMatchObject({ result: 'correct', note: expect.stringContaining('fotosyntes') });
    expect(gradeText('respiration', spec).result).toBe('wrong');
  });

  test('a slip at the start or end of the word is "nästan", not right — it is often another word', () => {
    expect(gradeText('elektrod', { accepted: ['elektron'] })).toMatchObject({ result: 'partial', note: expect.stringContaining('elektron') });
    expect(gradeText('adsorption', { accepted: ['absorption'] }).result).toBe('partial');
    expect(gradeText('fotosyntez', spec)).toMatchObject({ result: 'partial', expected: 'fotosyntes' });
    // En annan godkänd variant som stämmer bättre vinner.
    expect(gradeText('elektrod', { accepted: ['elektron', 'elektrod'] }).result).toBe('correct');
    // Ord för ord när svaret har flera ord.
    expect(gradeText('elektrod och proton', { accepted: ['elektron och proton'] }).result).toBe('partial');
  });

  test('an added or dropped ending and missing dots are ordinary slips, not another word (review of #120)', () => {
    expect(gradeText('bakterien', { accepted: ['bakterie'] }).result).toBe('correct');
    expect(gradeText('mitokondrien', { accepted: ['mitokondrie'] }).result).toBe('correct');
    expect(gradeText('Ostersjön', { accepted: ['Östersjön'] }).result).toBe('correct');
    expect(gradeText('klorofyl', { accepted: ['klorofyll'] }).result).toBe('correct');
  });

  test('numbers (years) must match exactly; short words get no typo slack', () => {
    expect(gradeText('1798', { accepted: ['1789'] }).result).toBe('wrong');
    expect(gradeText('1789', { accepted: ['1789'] }).result).toBe('correct');
    expect(gradeText('katt', { accepted: ['kalt'] }).result).toBe('wrong');
  });

  test('Swedish letters are compared correctly', () => {
    expect(gradeText('ÖSTERSJÖN', { accepted: ['Östersjön'] }).result).toBe('correct');
  });

  test('no typo slack below 8 letters, for Roman numerals or when exact (audit)', () => {
    expect(gradeText('metanol', { accepted: ['etanol'] }).result).toBe('wrong');
    expect(gradeText('propen', { accepted: ['propan'] }).result).toBe('wrong');
    expect(gradeText('Karl XI', { accepted: ['Karl XII'] }).result).toBe('wrong');
    expect(gradeText('Gustav II Adolf', { accepted: ['Gustav III Adolf'] }).result).toBe('wrong');
    expect(gradeText('klorfyll', { accepted: ['klorofyll'] }).result).toBe('correct');
    expect(gradeText('klorfyll', { accepted: ['klorofyll'], exact: true }).result).toBe('wrong');
    // Två stavfel först från 12 tecken.
    expect(gradeText('fotosytnesen', { accepted: ['fotosyntesen'] }).result).toBe('correct');
    expect(gradeText('fotosyntesne', { accepted: ['fotosyntesen'] }).result).toBe('partial');
    expect(gradeText('fotosyntzz', { accepted: ['fotosyntes'] }).result).toBe('wrong');
  });

  test('empty answer is invalid', () => {
    expect(gradeText('   ', spec).invalid).toBe(true);
  });
});

describe('gradeAnswer', () => {
  test('cards and open questions are self-assessed', () => {
    expect(gradeAnswer({ kind: 'card', back: 'B' }, { self: 'partial' })).toEqual({ result: 'partial', expected: 'B' });
    expect(gradeAnswer({ kind: 'card', back: 'B' }, {}).invalid).toBe(true);
    const open = { kind: 'exercise', answer: { type: 'self', modelAnswer: 'M' } };
    expect(gradeAnswer(open, { self: 'correct' })).toEqual({ result: 'correct', expected: 'M' });
  });

  test('dispatches automatic types', () => {
    expect(gradeAnswer({ kind: 'exercise', answer: { type: 'number', value: 2 } }, { answer: '2' }).result).toBe('correct');
    expect(gradeAnswer({ kind: 'exercise', answer: { type: 'text', accepted: ['Stockholm'] } }, { answer: 'stockholm' }).result).toBe('correct');
  });
});

test('levenshtein', () => {
  expect(levenshtein('kitten', 'sitting')).toBe(3);
  expect(levenshtein('', 'abc')).toBe(3);
  expect(levenshtein('same', 'same')).toBe(0);
});

describe('several right (multi)', () => {
  const spec = { type: 'multi', choices: ['21', '23', '27', '29'], correctIndices: [1, 3] };
  const { gradeMulti } = require('./grading');

  test('all the right ones and nothing else', () => {
    expect(gradeMulti([3, 1], spec)).toMatchObject({ result: 'correct', expected: '23, 29' });
  });

  test('only right ones but one missing is nearly; a wrong pick is wrong', () => {
    expect(gradeMulti([1], spec)).toMatchObject({ result: 'partial' });
    expect(gradeMulti([1, 2, 3], spec)).toMatchObject({ result: 'wrong' });
  });

  test('nothing picked or nonsense is not counted', () => {
    expect(gradeMulti([], spec).invalid).toBe(true);
    expect(gradeMulti([9], spec).invalid).toBe(true);
    expect(gradeMulti([1, 1], spec).invalid).toBe(true);
    expect(gradeMulti('1', spec).invalid).toBe(true);
  });
});

describe('order', () => {
  const { gradeOrder } = require('./grading');
  const spec = { type: 'order', choices: ['0,05', '0,5', '5'] };

  test('right order is right, anything else wrong', () => {
    expect(gradeOrder(['0,05', '0,5', '5'], spec)).toMatchObject({ result: 'correct', expected: '0,05 → 0,5 → 5' });
    expect(gradeOrder(['0,5', '0,05', '5'], spec)).toMatchObject({ result: 'wrong' });
  });

  test('missing or foreign items are not counted', () => {
    expect(gradeOrder(['0,05', '0,5'], spec).invalid).toBe(true);
    expect(gradeOrder(['0,05', '0,5', '50'], spec).invalid).toBe(true);
  });
});

describe('factors', () => {
  const { parseFactors, gradeFactors, describeAnswer } = require('./grading');
  const spec = { type: 'factors', factors: [2, 3, 3, 5] };

  test('written the way students write them', () => {
    for (const s of ['2·3·3·5', '3*2*5*3', '2·3²·5', '2 · 3^2 · 5', '90 = 2·3·3·5', '2 3 3 5', '2x3x3x5', '2 × 3 × 3 × 5']) {
      expect([s, [...parseFactors(s)].sort((a, b) => a - b)]).toEqual([s, [2, 3, 3, 5]]);
    }
    expect(parseFactors('två gånger tre')).toBeNull();
    expect(parseFactors('1·90')).toBeNull();
  });

  test('any order is right; the right product with other factors is nearly', () => {
    expect(gradeFactors('5·3·2·3', spec)).toMatchObject({ result: 'correct', expected: '2 · 3 · 3 · 5' });
    expect(gradeFactors('2·45', spec)).toMatchObject({ result: 'partial' });
    expect(gradeFactors('2·3·5', spec)).toMatchObject({ result: 'wrong' });
    expect(gradeFactors('nittio', spec).invalid).toBe(true);
  });

  test('the answer as text for the history', () => {
    const multi = { answer: { type: 'multi', choices: ['21', '23', '27', '29'] } };
    expect(describeAnswer(multi, [1, 3])).toBe('23, 29');
    expect(describeAnswer({ answer: { type: 'order' } }, ['a', 'b'])).toBe('a → b');
    expect(describeAnswer({ answer: { type: 'choice', choices: ['x', 'y'] } }, 1)).toBe('y');
  });
});
