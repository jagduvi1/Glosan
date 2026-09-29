/**
 * Johans regel för Plugga: Glosan anropar ALDRIG någon AI-API i modulen —
 * all AI-hjälp sker i användarens egen AI via MCP. Det här testet vaktar
 * regeln: ingen Plugga-fil får nå Anthropic-tjänsten eller SDK:t, varken
 * direkt eller via något den i sin tur importerar. require-sökvägarna löses
 * upp på riktigt (så "../anthropic" från services/study/ fångas också).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const STUDY_FILES = [
  'routes/study.js',
  'routes/studyInvites.js',
  'mcp/tools/study.js',
  'services/studyData.js',
  ...fs.readdirSync(path.join(ROOT, 'services/study'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => `services/study/${f}`)
];
const FORBIDDEN_FILES = new Set([path.join(ROOT, 'services/anthropic.js')]);
const FORBIDDEN_PACKAGES = /^@anthropic-ai\//;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Filen som en relativ require pekar på (eller null för paket). */
function resolveLocal(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Alla filer och paket som `file` når, transitivt inom backend/src. */
function reachable(file, seen = new Set(), packages = new Set()) {
  if (seen.has(file)) return { seen, packages };
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(REQUIRE_RE)) {
    const local = resolveLocal(file, spec);
    if (local) reachable(local, seen, packages);
    else if (!spec.startsWith('.')) packages.add(spec);
  }
  return { seen, packages };
}

test.each(STUDY_FILES)('%s does not reach an AI API', (rel) => {
  const { seen, packages } = reachable(path.join(ROOT, rel));
  expect([...seen].filter((f) => FORBIDDEN_FILES.has(f)).map((f) => path.relative(ROOT, f))).toEqual([]);
  expect([...packages].filter((p) => FORBIDDEN_PACKAGES.test(p))).toEqual([]);
});

test('the guard itself catches the imports it is meant to catch', () => {
  const probe = path.join(ROOT, 'services/study/grading.js');
  expect(resolveLocal(probe, '../anthropic')).toBe(path.join(ROOT, 'services/anthropic.js'));
  expect(resolveLocal(path.join(ROOT, 'services/studyData.js'), './anthropic')).toBe(path.join(ROOT, 'services/anthropic.js'));
});
