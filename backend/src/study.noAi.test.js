/**
 * Johans regel för Plugga: Glosan anropar ALDRIG någon AI-API i modulen —
 * all AI-hjälp sker i användarens egen AI via MCP. Det här testet vaktar
 * regeln: ingen Plugga-fil får importera Anthropic-tjänsten eller SDK:t.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const STUDY_FILES = [
  'routes/study.js',
  'mcp/tools/study.js',
  'services/studyData.js',
  ...fs.readdirSync(path.join(ROOT, 'services/study'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => `services/study/${f}`)
];

test.each(STUDY_FILES)('%s does not call an AI API', (rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  expect(src).not.toMatch(/services\/anthropic|@anthropic-ai|aiQuota/);
});
