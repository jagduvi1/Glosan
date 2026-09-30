/**
 * Figurer (```svg i texten) får bara vara ritning och text — kontrolleras när
 * AI:n skriver dem, som extra skydd (appen visar dem ändå bara som bilder).
 */
const { figureProblems } = require('./figures');

const fig = (svg) => `Vilket tal pekar pilen på?\n\n\`\`\`svg\n${svg}\n\`\`\`\n`;
const LINE = '<svg viewBox="0 0 300 40" width="300"><line x1="10" y1="20" x2="290" y2="20" stroke="black"/><text x="10" y="35">0</text></svg>';

test('a plain drawing passes, and text without figures too', () => {
  expect(figureProblems(fig(LINE))).toEqual([]);
  expect(figureProblems('Lös $2x = 8$')).toEqual([]);
  expect(figureProblems(undefined)).toEqual([]);
});

test('scripts, links, images, styles and event handlers are refused', () => {
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="https://x"><text>x</text></a></svg>',
    '<svg><image href="https://x/y.png"/></svg>',
    '<svg><use xlink:href="#a"/></svg>',
    '<svg><style>@import url(x)</style></svg>',
    '<svg><rect fill="url(#g)"/></svg>',
    '<svg><foreignObject><div>x</div></foreignObject></svg>',
    '<svg><animate attributeName="x"/></svg>'
  ]) {
    expect([bad, figureProblems(fig(bad)).length]).toEqual([bad, 1]);
  }
});

test('one <svg> per block, closed fences, and a size limit', () => {
  expect(figureProblems(fig('<div>x</div>'))[0]).toMatch(/exactly one <svg>/);
  expect(figureProblems('```svg\n<svg></svg>')[0]).toMatch(/not closed/);
  expect(figureProblems(fig(`<svg>${'<circle r="1"/>'.repeat(3000)}</svg>`))[0]).toMatch(/max/);
});
