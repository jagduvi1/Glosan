// Underhåll som körs i backend-processen en gång i timmen (startas i server.js):
//
//  1. Disk: mejla Glosans admins när disken är nästan full. I augusti 2026 låg
//     Glosan nere i tre veckor för att disken tagit slut — och ingen märkte det.
//     Containerns filsystem visar värddiskens beläggning, så ingen cron på
//     VM:n behövs. Högst ett mejl per dygn så länge det är fullt.
//  2. Plugga: stäng pass som övergetts (ingen aktivitet på 6 timmar) — annars
//     ligger de öppna för alltid. Stängningen ger ingen XP; det gör bara
//     "Avsluta" (eller att sidan lämnas, som skickar det åt eleven).
const fs = require('fs');
const User = require('../models/User');
const StudySession = require('../models/StudySession');
const email = require('./email');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const STALE_SESSION_MS = 6 * HOUR;

const diskAlertAt = () => Math.min(99, Math.max(50, Number(process.env.DISK_ALERT_PERCENT) || 85)) / 100;
let lastDiskAlertAt = 0;

/** Använd andel (0–1) och ledigt utrymme för filsystemet under `path`, eller null. */
function diskUsage(path = '/') {
  try {
    const s = fs.statfsSync(path);
    if (!s.blocks) return null;
    return { used: 1 - s.bavail / s.blocks, freeBytes: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

/**
 * Varna admins om disken. `usage` och `send` kan bytas ut i test. Returnerar
 * { used, alerted }.
 */
async function checkDisk({ now = Date.now(), usage = diskUsage(), send = email.send, mailEnabled = email.isEnabled() } = {}) {
  if (!usage || usage.used < diskAlertAt()) return { used: usage?.used ?? null, alerted: false };
  const pct = Math.round(usage.used * 100);
  const freeGb = (usage.freeBytes / 1024 ** 3).toFixed(1);
  console.warn(`[maintenance] disk ${pct} % full (${freeGb} GB free)`);
  if (!mailEnabled || now - lastDiskAlertAt < DAY) return { used: usage.used, alerted: false };
  const admins = await User.find({ roles: 'admin' }, 'email').lean();
  const to = admins.map((a) => a.email).filter(Boolean);
  if (!to.length) return { used: usage.used, alerted: false };
  lastDiskAlertAt = now;
  await send({
    to,
    subject: `Glosan: disken är ${pct} % full`,
    text: [
      `Disken på Glosans server är ${pct} % full (${freeGb} GB kvar).`,
      '',
      'När den blir full slutar MongoDB fungera — det var så Glosan låg nere i augusti 2026.',
      'Rensa till exempel gamla Docker-images (docker image prune -a) och byggcache (docker builder prune),',
      'eller se efter vad som växer med: sudo du -xh / --max-depth=2 | sort -h | tail',
      '',
      'Du får ett nytt mejl om ett dygn om disken fortfarande är full.'
    ].join('\n')
  });
  return { used: usage.used, alerted: true };
}

/** Stäng Plugga-pass utan aktivitet på STALE_SESSION_MS. Returnerar antalet. */
async function closeStaleSessions(now = new Date()) {
  const r = await StudySession.updateMany(
    { endedAt: null, lastActiveAt: { $lt: new Date(now.getTime() - STALE_SESSION_MS) } },
    { $set: { endedAt: now } }
  );
  return r.modifiedCount || 0;
}

async function runMaintenance() {
  for (const [name, task] of [['disk', () => checkDisk()], ['sessions', () => closeStaleSessions()]]) {
    try {
      await task();
    } catch (err) {
      console.error(`[maintenance] ${name} failed:`, err.message);
    }
  }
}

/** Starta timmesjobbet (första körningen efter en minut). unref: håller aldrig processen vid liv. */
function startMaintenance() {
  setTimeout(runMaintenance, 60 * 1000).unref();
  setInterval(runMaintenance, HOUR).unref();
}

function _resetAlerts() {
  lastDiskAlertAt = 0;
}

module.exports = { startMaintenance, runMaintenance, checkDisk, closeStaleSessions, diskUsage, STALE_SESSION_MS, _resetAlerts };
