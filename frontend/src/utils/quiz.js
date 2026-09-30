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
// Högst så här många: "a/b a/b a/b …" (en delad lista) gav annars 2^50
// kombinationer och frös webbläsaren. Riktiga glosor har en handfull.
const MAX_VARIANTS = 64;

export function answerVariants(target) {
  const tokens = String(target ?? '').trim().split(/\s+/);
  const perToken = tokens.map((t) => t.split('/').map((s) => s.trim()).filter(Boolean));
  let acc = [[]];
  for (const opts of perToken) {
    const next = [];
    for (const prefix of acc) {
      for (const opt of opts) {
        if (next.length >= MAX_VARIANTS) break;
        next.push([...prefix, opt]);
      }
    }
    acc = next;
  }
  return acc.map((parts) => parts.join(' ').toLowerCase());
}

// Is `given` one of the accepted phrasings? Word by word, like the server's
// live duel — never through the (capped) list of all combinations, so a word
// with many alternatives is still graded right. Case and spacing are ignored.
export function matchesAnswer(given, target) {
  const words = String(given ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = String(target ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.length !== tokens.length) return false;
  return tokens.every((t, i) => t.split('/').map((s) => s.trim()).filter(Boolean).includes(words[i]));
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
  if (matchesAnswer(t, expectedWord)) return true;
  const variants = answerVariants(expectedWord);
  for (const v of variants) {
    const threshold = v.length >= 7 ? 2 : v.length >= 4 ? 1 : 0;
    if (threshold === 0) continue;
    if (levenshtein(t, v) <= threshold) return true;
  }
  return false;
}

// Was a wrong typed answer close to an accepted one (a slip, a missing dot)?
// Only decides how the feedback sounds — "Nära! Det stavas …" vs "Inte
// riktigt — rätt svar: …". Text mode still grades exactly.
export function isNearMiss(given, expectedWord) {
  if (!given || !expectedWord) return false;
  const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const g = fold(given);
  return answerVariants(expectedWord).some((v) => {
    const f = fold(v);
    const threshold = f.length >= 7 ? 2 : f.length >= 3 ? 1 : 0;
    return levenshtein(g, f) <= threshold;
  });
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
