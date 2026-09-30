// Per-användar-budget för SKRIVANDE MCP-anrop. /api/mcp är undantagen från
// app.js writeLimiter (ett POST kan inte klassas som läs/skriv utifrån — det
// avgörs per verktygsanrop inne i JSON-RPC-kuvertet), så klassningen sker här,
// där readOnlyHint berättar sanningen. En AI som loopar create_list slår i
// samma vägg som en REST-klient som loopar POST /api/lists.
//
// Glidande fönster i minnet: backend kör som en enda process, och en omstart
// som nollställer räknarna är ofarlig.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_WRITES = 120; // något över REST:ens 100/15 min — ett anrop kan vara en hel lista
const buckets = new Map(); // userId → timestamps (ms), äldst först

function prune(list, now) {
  while (list.length && list[0] <= now - WINDOW_MS) list.shift();
}

/** Ta en skrivplats för användaren. false = budgeten är slut just nu. */
function takeMutationSlot(userId, now = Date.now()) {
  const key = String(userId);
  let list = buckets.get(key);
  if (!list) {
    list = [];
    buckets.set(key, list);
  }
  prune(list, now);
  if (list.length >= MAX_WRITES) return false;
  list.push(now);
  return true;
}

// Städa tomma hinkar så kartan inte växer med varje användare som någonsin
// skrivit. unref: timern får aldrig hålla processen (eller jest) vid liv.
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of buckets) {
    prune(list, now);
    if (!list.length) buckets.delete(key);
  }
}, WINDOW_MS).unref();

// Volym per dygn: 120 skrivanrop per kvart kan var och ett vara nära 1 MB,
// så antalet räcker inte som skydd för disken. Varje skrivanrops argument
// räknas (JSON-längd) mot en dygnsbudget per användare — långt över vad en
// elev skapar (en lista med 300 glosor ≈ 30 kB, ett område ≈ 100–300 kB).
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WRITE_BYTES_PER_DAY = 10 * 1024 * 1024;
const byteBuckets = new Map(); // userId → [{ at, bytes }], äldst först

/** Dra `bytes` från användarens dygnsbudget. false = budgeten räcker inte. */
function takeWriteBytes(userId, bytes, now = Date.now()) {
  const key = String(userId);
  let list = byteBuckets.get(key);
  if (!list) {
    list = [];
    byteBuckets.set(key, list);
  }
  while (list.length && list[0].at <= now - DAY_MS) list.shift();
  const used = list.reduce((sum, e) => sum + e.bytes, 0);
  if (used + bytes > MAX_WRITE_BYTES_PER_DAY) return false;
  list.push({ at: now, bytes });
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, list] of byteBuckets) {
    while (list.length && list[0].at <= now - DAY_MS) list.shift();
    if (!list.length) byteBuckets.delete(key);
  }
}, 60 * 60 * 1000).unref();

function _reset() {
  buckets.clear();
  byteBuckets.clear();
}

module.exports = { takeMutationSlot, takeWriteBytes, WINDOW_MS, MAX_WRITES, MAX_WRITE_BYTES_PER_DAY, _reset };
