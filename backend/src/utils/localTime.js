// Svensk lokal tid för "Min plugg": dagar, veckor (måndag–söndag, v. 40),
// månader och terminer räknas i Europe/Stockholm — servern kör i UTC, och en
// elev som pluggar 23.30 ska få det på rätt dag. Rena funktioner; datum som
// strängar 'YYYY-MM-DD' (lokala kalenderdatum).

const TZ = 'Europe/Stockholm';
const DAY_MS = 24 * 60 * 60 * 1000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Tidszonens förskjutning i minuter vid ett UTC-ögonblick (60 vintertid, 120 sommartid). */
function tzOffsetMinutes(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Lokalt kalenderdatum ('YYYY-MM-DD') för ett ögonblick. */
function localYmd(date = new Date()) {
  return ymdFmt.format(date);
}

function parseYmd(s) {
  const m = YMD_RE.exec(s || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** UTC-ögonblicket då det lokala dygnet `ymd` börjar (hanterar sommartid). */
function startOfLocalDay(ymd) {
  const { y, m, d } = parseYmd(ymd);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMinutes(new Date(guess)) * 60000;
  const second = guess - tzOffsetMinutes(new Date(first)) * 60000;
  return new Date(second);
}

/** Kalenderräkning på datumsträngar (utan tidszon — ren kalender). */
function addDays(ymd, n) {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

function addMonths(ymd, n) {
  const { y, m } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 10);
}

/** 0 = måndag … 6 = söndag. */
function weekday(ymd) {
  const { y, m, d } = parseYmd(ymd);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** ISO-veckonummer (som i svenska almanackor). */
function isoWeek(ymd) {
  const thursday = addDays(ymd, 3 - weekday(ymd));
  const { y } = parseYmd(thursday);
  const jan4 = `${y}-01-04`;
  const week1Monday = addDays(jan4, -weekday(jan4));
  const days = Math.round((Date.parse(thursday) - Date.parse(week1Monday)) / DAY_MS);
  return Math.floor(days / 7) + 1;
}

const PERIODS = ['day', 'week', 'month', 'term'];
const MIN_YMD = '2000-01-01';
const MAX_YMD = '2099-12-31';

/**
 * Perioden som innehåller `anchor`: { period, start, end (exkl.), prev, next,
 * from, to } där start/end/prev/next är lokala datum och from/to UTC-ögonblick.
 * Veckor börjar på måndag; terminer är VT jan–jun och HT jul–dec (utils/term.js).
 */
function periodRange(period, anchor) {
  const p = PERIODS.includes(period) ? period : 'week';
  // Datum utanför 2000–2099 (år 9999 …) blir idag — annars blir kalender-
  // räkningen fel (sexsiffriga år) och frågan meningslös.
  const a = parseYmd(anchor) && anchor >= MIN_YMD && anchor <= MAX_YMD ? anchor : localYmd();
  let start;
  let end;
  let prev;
  if (p === 'day') {
    start = a;
    end = addDays(a, 1);
    prev = addDays(a, -1);
  } else if (p === 'week') {
    start = addDays(a, -weekday(a));
    end = addDays(start, 7);
    prev = addDays(start, -7);
  } else if (p === 'month') {
    start = `${a.slice(0, 7)}-01`;
    end = addMonths(start, 1);
    prev = addMonths(start, -1);
  } else {
    const { y, m } = parseYmd(a);
    start = m >= 7 ? `${y}-07-01` : `${y}-01-01`;
    end = addMonths(start, 6);
    prev = addMonths(start, -6);
  }
  return { period: p, anchor: a, start, end, prev, next: end, from: startOfLocalDay(start), to: startOfLocalDay(end) };
}

/** Alla lokala datum i [start, end). */
function daysBetween(start, end) {
  const out = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

module.exports = {
  TZ, PERIODS, tzOffsetMinutes, localYmd, parseYmd, startOfLocalDay, addDays, addMonths, weekday, isoWeek, periodRange, daysBetween
};
