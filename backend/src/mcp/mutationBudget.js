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

function _reset() {
  buckets.clear();
}

module.exports = { takeMutationSlot, WINDOW_MS, MAX_WRITES, _reset };
