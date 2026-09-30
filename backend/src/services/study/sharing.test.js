/**
 * Att ta bort en kompis avslutar delningen av Plugga-områden åt båda hållen
 * (audit: det finns ingen blockering, så det här är vägen att stänga av
 * någons felrapporter). Modellerna fejkas — sviten har ingen Mongo.
 */
jest.mock('../../models/StudyUnit', () => ({ find: jest.fn(), updateMany: jest.fn(async () => ({})) }));
jest.mock('../../models/StudyFolder', () => ({ updateMany: jest.fn(async () => ({})) }));
jest.mock('../../models/StudyFlag', () => ({ deleteMany: jest.fn(async () => ({})) }));

const StudyUnit = require('../../models/StudyUnit');
const StudyFolder = require('../../models/StudyFolder');
const StudyFlag = require('../../models/StudyFlag');
const { unshareBetween } = require('./sharing');

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';
const UNIT_OF_A = '64b0000000000000000000a1';

test('unfriending stops sharing both ways and cleans up after the recipient', async () => {
  // A har delat ett område med B; B har inget delat med A.
  StudyUnit.find.mockImplementation((q) => ({
    lean: async () => (String(q.user) === A && String(q.sharedWith) === B ? [{ _id: UNIT_OF_A }] : [])
  }));
  await unshareBetween(A, B);

  expect(StudyUnit.find).toHaveBeenCalledTimes(2);
  const [[q1], [q2]] = StudyUnit.find.mock.calls;
  expect([String(q1.user), String(q1.sharedWith)]).toEqual([A, B]);
  expect([String(q2.user), String(q2.sharedWith)]).toEqual([B, A]);

  expect(StudyUnit.updateMany).toHaveBeenCalledTimes(1);
  const [filter, update] = StudyUnit.updateMany.mock.calls[0];
  expect(filter._id.$in).toEqual([UNIT_OF_A]);
  expect(String(update.$pull.sharedWith)).toBe(B);
  const [folderFilter] = StudyFolder.updateMany.mock.calls[0];
  expect(String(folderFilter.user)).toBe(B);
  const [flagFilter] = StudyFlag.deleteMany.mock.calls[0];
  expect(flagFilter).toMatchObject({ status: 'open' });
  expect(String(flagFilter.reporter)).toBe(B);
});

test('bad ids never reach the database', async () => {
  StudyUnit.find.mockClear();
  await unshareBetween(A, '{"$ne":null}');
  expect(StudyUnit.find).not.toHaveBeenCalled();
});
