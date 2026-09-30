/**
 * Diskvarningen: augusti 2026 tog disken slut och Glosan låg nere i tre
 * veckor utan att någon märkte det. Nu mejlas admins — högst en gång per dygn.
 */
jest.mock('../models/User', () => ({
  find: () => ({ lean: async () => [{ email: 'admin@example.test' }, { email: null }] })
}));
jest.mock('../models/StudySession', () => ({ updateMany: jest.fn(async () => ({ modifiedCount: 2 })) }));

const StudySession = require('../models/StudySession');
const { checkDisk, closeStaleSessions, diskUsage, STALE_SESSION_MS, _resetAlerts } = require('./maintenance');

beforeEach(() => _resetAlerts());

test('a nearly full disk mails the admins, once a day', async () => {
  const send = jest.fn(async () => ({}));
  const usage = { used: 0.91, freeBytes: 3.4 * 1024 ** 3 };
  const t0 = 1_000_000_000;
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const first = await checkDisk({ now: t0, usage, send, mailEnabled: true });
  expect(first.alerted).toBe(true);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: ['admin@example.test'], subject: 'Glosan: disken är 91 % full' }));
  expect((await checkDisk({ now: t0 + 60 * 60 * 1000, usage, send, mailEnabled: true })).alerted).toBe(false);
  expect((await checkDisk({ now: t0 + 25 * 60 * 60 * 1000, usage, send, mailEnabled: true })).alerted).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});

test('a mail that fails is retried next hour, not a day later (review of #119)', async () => {
  const usage = { used: 0.9, freeBytes: 4 * 1024 ** 3 };
  const t0 = 2_000_000_000;
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const down = jest.fn(async () => { throw new Error('resend down'); });
  await expect(checkDisk({ now: t0, usage, send: down, mailEnabled: true })).rejects.toThrow('resend down');
  const up = jest.fn(async () => ({}));
  expect((await checkDisk({ now: t0 + 60 * 60 * 1000, usage, send: up, mailEnabled: true })).alerted).toBe(true);
  warn.mockRestore();
});

test('a disk with room is left alone', async () => {
  const send = jest.fn();
  expect((await checkDisk({ usage: { used: 0.5, freeBytes: 18 * 1024 ** 3 }, send, mailEnabled: true })).alerted).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

test('the real disk can be read', () => {
  const u = diskUsage();
  expect(u === null || (u.used >= 0 && u.used <= 1)).toBe(true);
});

test('abandoned study sessions are closed after 6 hours', async () => {
  const now = new Date('2026-09-30T12:00:00Z');
  expect(await closeStaleSessions(now)).toBe(2);
  const [filter, update] = StudySession.updateMany.mock.calls[0];
  expect(filter.endedAt).toBeNull();
  expect(filter.lastActiveAt.$lt.getTime()).toBe(now.getTime() - STALE_SESSION_MS);
  expect(update.$set.endedAt).toBe(now);
});
