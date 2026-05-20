// Shared quiz / flashcards helpers.

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Expand slash-separated alternatives in a target into every accepted phrasing.
// "mycket söt/gullig" → ["mycket söt", "mycket gullig"]
// "den/det är/var" → ["den är", "den var", "det är", "det var"]
export function answerVariants(target) {
  const tokens = target.trim().split(/\s+/);
  const perToken = tokens.map((t) => t.split('/').map((s) => s.trim()).filter(Boolean));
  return perToken
    .reduce((acc, opts) => acc.flatMap((prefix) => opts.map((opt) => [...prefix, opt])), [[]])
    .map((parts) => parts.join(' ').toLowerCase());
}

// Plain Levenshtein edit distance. Used to forgive close STT mis-hearings
// in voice mode (e.g. "red" vs "read"). Not used for text mode.
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j - 1], dp[j]);
      }
      prev = tmp;
    }
  }
  return dp[n];
}

// True if the spoken transcript is "close enough" to an accepted answer.
// Voice-only — text mode keeps exact (variants-only) matching so spelling
// stays meaningful. Length-scaled threshold so very short words still need
// to match exactly.
export function isVoiceMatch(transcript, expectedWord) {
  if (!transcript || !expectedWord) return false;
  const t = transcript.trim().toLowerCase();
  const variants = answerVariants(expectedWord);
  if (variants.includes(t)) return true;
  for (const v of variants) {
    const threshold = v.length >= 7 ? 2 : v.length >= 4 ? 1 : 0;
    if (threshold === 0) continue;
    if (levenshtein(t, v) <= threshold) return true;
  }
  return false;
}

// Pick 3 distractor strings from `pool` for choice mode, excluding the current
// glos and any others whose `expectedField` matches it (so duplicates aren't shown).
export function buildDistractors(currentGlos, pool, expectedField) {
  const target = (currentGlos[expectedField] || '').trim().toLowerCase();
  const others = pool.filter((g) =>
    g._id !== currentGlos._id && (g[expectedField] || '').trim().toLowerCase() !== target
  );
  return shuffle(others).slice(0, 3).map((g) => g[expectedField]);
}
