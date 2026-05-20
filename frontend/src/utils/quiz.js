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

// Pick 3 distractor strings from `pool` for choice mode, excluding the current
// glos and any others whose `expectedField` matches it (so duplicates aren't shown).
export function buildDistractors(currentGlos, pool, expectedField) {
  const target = (currentGlos[expectedField] || '').trim().toLowerCase();
  const others = pool.filter((g) =>
    g._id !== currentGlos._id && (g[expectedField] || '').trim().toLowerCase() !== target
  );
  return shuffle(others).slice(0, 3).map((g) => g[expectedField]);
}
