/**
 * Att ta bort en kompis avslutar delningen av Plugga-områden åt båda hållen
 * (audit: det finns ingen blockering, så det här är vägen att stänga av
 * någons felrapporter) — även det den ena delat vidare till den andra. Den som
 * tas bort ur ett område tappar också sina länkar till det. Modellerna fejkas —
 * sviten har ingen Mongo.
 */
jest.mock('../../models/StudyUnit', () => ({ find: jest.fn(), updateMany: jest.fn(async () => ({})) }));
jest.mock('../../models/StudyFolder', () => ({ updateMany: jest.fn(async () => ({})) }));
jest.mock('../../models/StudyFlag', () => ({ deleteMany: jest.fn(async () => ({})) }));
jest.mock('../../models/StudyShareLink', () => ({
  find: jest.fn(async () => []),
  findOne: jest.fn(),
  updateOne: jest.fn(async () => ({ matchedCount: 1 }))
}));

const StudyUnit = require('../../models/StudyUnit');
const StudyFolder = require('../../models/StudyFolder');
const StudyFlag = require('../../models/StudyFlag');
const StudyShareLink = require('../../models/StudyShareLink');
const { unshareBetween, removeRecipient, revokeShareLink } = require('./sharing');

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';
const C = '64b000000000000000000003';
const UNIT_OF_A = '64b0000000000000000000a1';
const UNIT_OF_C = '64b0000000000000000000c1';

beforeEach(() => jest.clearAllMocks());

test('unfriending stops sharing both ways and cleans up after the recipient', async () => {
  // A har delat ett område med B; B har inget delat med A.
  StudyUnit.find.mockImplementation((q) => ({
    lean: async () => (String(q.$or[0].user) === A && String(q.sharedWith) === B ? [{ _id: UNIT_OF_A }] : [])
  }));
  await unshareBetween(A, B);

  expect(StudyUnit.find).toHaveBeenCalledTimes(2);
  const [[q1], [q2]] = StudyUnit.find.mock.calls;
  // Den enas egna områden — och det den ena delat vidare till den andra.
  expect([String(q1.$or[0].user), String(q1.sharedWith)]).toEqual([A, B]);
  expect([String(q1.$or[1].sharedVia.$elemMatch.by), String(q1.$or[1].sharedVia.$elemMatch.user)]).toEqual([A, B]);
  expect([String(q2.$or[0].user), String(q2.sharedWith)]).toEqual([B, A]);

  expect(StudyUnit.updateMany).toHaveBeenCalledTimes(1);
  const [filter, update] = StudyUnit.updateMany.mock.calls[0];
  expect(filter._id.$in).toEqual([UNIT_OF_A]);
  expect(String(update.$pull.sharedWith)).toBe(B);
  expect(String(update.$pull.sharedVia.user)).toBe(B);
  const [folderFilter] = StudyFolder.updateMany.mock.calls[0];
  expect(String(folderFilter.user)).toBe(B);
  const [flagFilter] = StudyFlag.deleteMany.mock.calls[0];
  expect(flagFilter).toMatchObject({ status: 'open' });
  expect(String(flagFilter.reporter)).toBe(B);
  // B:s länkar till A:s område slutar gälla det.
  expect(String(StudyShareLink.find.mock.calls[0][0].creator)).toBe(B);
});

test('bad ids never reach the database', async () => {
  await unshareBetween(A, '{"$ne":null}');
  expect(StudyUnit.find).not.toHaveBeenCalled();
});

test('someone removed from a unit loses it from their links, in atomic steps', async () => {
  StudyShareLink.find.mockResolvedValueOnce([{ _id: 'L1', unit: UNIT_OF_A, units: [UNIT_OF_A, UNIT_OF_C] }]);
  await removeRecipient({ _id: UNIT_OF_A }, B);
  const [pull, move, close] = StudyShareLink.updateOne.mock.calls;
  // 1. ur listan över områden …
  expect(pull[0]._id).toBe('L1');
  expect(pull[1].$pull.units.$in.map(String)).toEqual([UNIT_OF_A]);
  // 2. … det första området flyttas till det som nu står först (en pipeline,
  //    så den läser länken som den är just då — inget skrivs tillbaka) …
  expect(move[0].unit.$in.map(String)).toEqual([UNIT_OF_A]);
  expect(move[0]['units.0']).toEqual({ $exists: true });
  expect(move[1]).toEqual([{ $set: { unit: { $arrayElemAt: ['$units', 0] } } }]);
  // 3. … och länken stängs bara om den inte gäller något område längre.
  expect(close[0]['units.0']).toEqual({ $exists: false });
  expect(close[1].$set.revokedAt).toBeInstanceOf(Date);
});

test('the creator of a unit can close a link someone else made to it — only for their own units', async () => {
  const unit = { _id: UNIT_OF_A, user: A, sharedWith: [B] };
  StudyShareLink.findOne.mockResolvedValueOnce({ _id: 'L1', creator: B, unit: UNIT_OF_A, units: [UNIT_OF_A, UNIT_OF_C] });
  StudyUnit.find.mockImplementation(() => ({ lean: async () => [{ _id: UNIT_OF_A }] }));
  // Skaparen ser andras länkar med id (aldrig koden) och stänger dem så.
  expect(await revokeShareLink(unit, '64b00000000000000000ff01', A)).toBe('trimmed');
  expect(String(StudyShareLink.findOne.mock.calls[0][0]._id)).toBe('64b00000000000000000ff01');
  const [, pull] = StudyShareLink.updateOne.mock.calls[0];
  expect(pull.$pull.units.$in.map(String)).toEqual([UNIT_OF_A]);

  // Någon annan som har området kan inte stänga B:s länk.
  StudyShareLink.findOne.mockResolvedValueOnce({ _id: 'L1', creator: B, unit: UNIT_OF_A });
  expect(await revokeShareLink(unit, 'ABCD1234', C)).toBe(false);

  // B stänger sin egen länk helt.
  StudyShareLink.findOne.mockResolvedValueOnce({ _id: 'L1', creator: B, unit: UNIT_OF_A, units: [UNIT_OF_A, UNIT_OF_C] });
  expect(await revokeShareLink(unit, 'ABCD1234', B)).toBe('closed');
  expect(StudyShareLink.findOne.mock.calls[2][0].code).toBe('ABCD1234');
});
