/**
 * Tester för Plugga-grunden (fas 0): funktionsflaggor, terminer,
 * uppgiftskoder och datamodellens valideringsregler. Rena funktioner och
 * Mongoose-validering (validateSync) — ingen databas behövs.
 */
const { effectiveFeatures, hasFeature, featuresForAll } = require('./config/features');
const { termFor, isValidTerm, termLabel, compareTerms, shiftTerm } = require('./utils/term');
const { parseStudyCode, formatItemCode } = require('./utils/studyCodes');
const { SUBJECTS, subjectByCode, subjectsInGroup } = require('./config/subjects');
const StudyItem = require('./models/StudyItem');
const StudyUnit = require('./models/StudyUnit');
const StudySession = require('./models/StudySession');
const StudyShareLink = require('./models/StudyShareLink');
const User = require('./models/User');

const OID = '64b000000000000000000001';

describe('feature flags', () => {
  const ORIGINAL = process.env.FEATURES_FOR_ALL;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FEATURES_FOR_ALL;
    else process.env.FEATURES_FOR_ALL = ORIGINAL;
  });

  test('per-user flags', () => {
    delete process.env.FEATURES_FOR_ALL;
    expect(hasFeature({ features: ['study'] }, 'study')).toBe(true);
    expect(hasFeature({ features: [] }, 'study')).toBe(false);
    expect(hasFeature(null, 'study')).toBe(false);
  });

  test('FEATURES_FOR_ALL turns a flag on for everyone and ignores unknown keys', () => {
    process.env.FEATURES_FOR_ALL = ' study , nonsense ';
    expect(featuresForAll()).toEqual(['study']);
    expect(hasFeature({ features: [] }, 'study')).toBe(true);
    expect(effectiveFeatures({ features: ['study'] })).toEqual(['study']);
  });

  test('User.toJSON exposes the EFFECTIVE flags and hides the code counters', () => {
    delete process.env.FEATURES_FOR_ALL;
    const u = new User({ username: 'majken', email: 'm@example.test', password: 'Abcdefghij1', features: ['study'] });
    u.studyCodeCounters = { MA: 3 };
    const json = u.toJSON();
    expect(json.features).toEqual(['study']);
    expect(json.studyCodeCounters).toBeUndefined();
    expect(json.password).toBeUndefined();
  });

  test('an unknown flag is rejected by the User schema', () => {
    const u = new User({ username: 'majken', email: 'm@example.test', password: 'Abcdefghij1', features: ['secret'] });
    expect(u.validateSync().errors['features.0']).toBeDefined();
  });
});

describe('terms (HT/VT)', () => {
  test('spring term is January–June, autumn term July–December', () => {
    expect(termFor(new Date(2027, 0, 8))).toBe('2027-VT');
    expect(termFor(new Date(2027, 5, 30))).toBe('2027-VT');
    expect(termFor(new Date(2026, 6, 1))).toBe('2026-HT');
    expect(termFor(new Date(2026, 11, 20))).toBe('2026-HT');
  });

  test('labels, validation, ordering and shifting', () => {
    expect(termLabel('2026-HT')).toBe('HT 2026');
    expect(isValidTerm('2026-HT')).toBe(true);
    expect(isValidTerm('2026-ht')).toBe(false);
    expect(isValidTerm('HT26')).toBe(false);
    expect(['2026-HT', '2025-HT', '2026-VT'].sort(compareTerms)).toEqual(['2025-HT', '2026-VT', '2026-HT']);
    expect(shiftTerm('2026-HT', 1)).toBe('2027-VT');
    expect(shiftTerm('2026-VT', -1)).toBe('2025-HT');
  });
});

describe('subjects', () => {
  test('codes are unique two-letter prefixes', () => {
    const codes = SUBJECTS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(subjectByCode('ma').key).toBe('matematik');
  });

  test('NO and SO group their subjects', () => {
    expect(subjectsInGroup('no')).toEqual(expect.arrayContaining(['fysik', 'kemi', 'biologi']));
    expect(subjectsInGroup('so')).toEqual(expect.arrayContaining(['historia', 'geografi', 'religion', 'samhallskunskap']));
  });
});

describe('exercise codes (written on paper, read from a photo)', () => {
  test.each([
    ['MA3-14', { unitCode: 'MA3', number: 14 }],
    ['ma3 14', { unitCode: 'MA3', number: 14 }],
    ['MA 3–14', { unitCode: 'MA3', number: 14 }],
    ['#FY12.7', { unitCode: 'FY12', number: 7 }],
    ['HI2 uppg 5', { unitCode: 'HI2', number: 5 }],
    [' SH1:3 ', { unitCode: 'SH1', number: 3 }],
    ['MA3', { unitCode: 'MA3', number: null }]
  ])('parses %p', (input, expected) => {
    expect(parseStudyCode(input)).toEqual(expected);
  });

  test.each(['XX3-14', 'MA-14', 'MA0-1', 'MA3-0', '', null, 'hej'])('rejects %p', (input) => {
    expect(parseStudyCode(input)).toBeNull();
  });

  test('formats a code', () => {
    expect(formatItemCode('MA3', 14)).toBe('MA3-14');
  });
});

describe('StudyItem validation', () => {
  const base = { unit: OID, user: OID, number: 1 };
  // Async validate(): typreglerna ligger i en pre('validate')-hook, som
  // validateSync() hoppar över men som create/save/insertMany alltid kör.
  const errorsOf = async (doc) => {
    try { await new StudyItem(doc).validate(); return []; } catch (e) { return Object.keys(e.errors || {}); }
  };

  test('a card needs a back side', async () => {
    expect(await errorsOf({ ...base, kind: 'card', prompt: 'Vad är en variabel?' })).toContain('back');
    expect(await errorsOf({ ...base, kind: 'card', prompt: 'Vad är en variabel?', back: 'En okänd storhet' })).toEqual([]);
  });

  test('an exercise needs a complete answer for its type', async () => {
    expect(await errorsOf({ ...base, kind: 'exercise', prompt: 'Lös $2x=6$' })).toContain('answer');
    expect(await errorsOf({ ...base, kind: 'exercise', prompt: 'Lös $2x=6$', answer: { type: 'number' } })).toContain('answer.value');
    expect(await errorsOf({ ...base, kind: 'exercise', prompt: 'Lös $2x=6$', answer: { type: 'number', value: 3 } })).toEqual([]);
  });

  test('choice: 2–8 choices and a valid correctIndex', async () => {
    const q = { ...base, kind: 'exercise', prompt: 'Vilket är ett primtal?' };
    expect(await errorsOf({ ...q, answer: { type: 'choice', choices: ['4'], correctIndex: 0 } })).toContain('answer.choices');
    expect(await errorsOf({ ...q, answer: { type: 'choice', choices: ['4', '7'], correctIndex: 2 } })).toContain('answer.correctIndex');
    expect(await errorsOf({ ...q, answer: { type: 'choice', choices: ['4', '7'], correctIndex: 1 } })).toEqual([]);
  });

  test('text needs an accepted answer; an open question needs a model answer', async () => {
    const q = { ...base, kind: 'exercise', prompt: 'Vad kallas processen?' };
    expect(await errorsOf({ ...q, answer: { type: 'text', accepted: [] } })).toContain('answer.accepted');
    expect(await errorsOf({ ...q, answer: { type: 'text', accepted: ['fotosyntes'] } })).toEqual([]);
    expect(await errorsOf({ ...q, answer: { type: 'self' } })).toContain('answer.modelAnswer');
    expect(await errorsOf({ ...q, answer: { type: 'self', modelAnswer: 'Växten omvandlar…' } })).toEqual([]);
  });

  test('levels are E/C/A and at most 5 hints', async () => {
    const ok = { ...base, kind: 'card', prompt: 'p', back: 'b' };
    expect(await errorsOf({ ...ok, level: 'B' })).toContain('level');
    expect(await errorsOf({ ...ok, hints: ['1', '2', '3', '4', '5', '6'] })).toContain('hints');
  });
});

describe('StudyUnit validation', () => {
  const base = { user: OID, subject: 'matematik', term: '2026-HT', code: 'MA3', title: 'Ekvationer' };
  const errorsOf = (doc) => Object.keys(new StudyUnit(doc).validateSync()?.errors || {});

  test('valid unit', () => {
    expect(errorsOf(base)).toEqual([]);
  });

  test('subject from the catalogue, term and code formats, grade 1–9', () => {
    expect(errorsOf({ ...base, subject: 'astrologi' })).toContain('subject');
    expect(errorsOf({ ...base, term: 'HT26' })).toContain('term');
    expect(errorsOf({ ...base, code: 'ma3' })).toContain('code');
    expect(errorsOf({ ...base, gradeYear: 10 })).toContain('gradeYear');
  });
});

describe('StudySession active time', () => {
  test('counts the gap since the last activity, capped so an idle screen is not study time', () => {
    const t0 = new Date('2026-09-29T15:00:00Z');
    expect(StudySession.activeIncrement(t0, new Date('2026-09-29T15:00:30Z'))).toBe(30);
    expect(StudySession.activeIncrement(t0, new Date('2026-09-29T15:45:00Z'))).toBe(StudySession.ACTIVE_GAP_CAP_SEC);
    expect(StudySession.activeIncrement(t0, t0)).toBe(0);
    expect(StudySession.activeIncrement(t0, new Date('2026-09-29T14:00:00Z'))).toBe(0);
  });
});

describe('StudyShareLink (QR / link to a unit)', () => {
  const base = () => new StudyShareLink({
    unit: '64b000000000000000000001', creator: '64b000000000000000000002', code: 'ABCD2345',
    expiresAt: new Date(Date.now() + 86400000), maxUses: 2
  });

  test('active until it expires, is used up or revoked', () => {
    const l = base();
    expect(l.isActive()).toBe(true);
    l.usedBy.push('64b000000000000000000003', '64b000000000000000000004');
    expect(l.isActive()).toBe(false);
    const expired = base();
    expect(expired.isActive(new Date(Date.now() + 2 * 86400000))).toBe(false);
    const revoked = base();
    revoked.revokedAt = new Date();
    expect(revoked.isActive()).toBe(false);
  });

  test('at most 300 uses per link', () => {
    const l = base();
    l.maxUses = 1000;
    expect(l.validateSync().errors.maxUses).toBeDefined();
  });
});
