// Figurer i Plugga: AI:n ritar tallinjer, faktorträd, koordinatsystem och
// geometri som SVG i ett ```svg-kodblock i Markdown-texten (fråga, baksida,
// lösning, genomgång). Appen visar dem som bilder — i ett <img> kan en SVG
// aldrig köra skript eller hämta något. Här kontrolleras de ändå när de skrivs,
// som ett extra skydd: bara ritning och text, inga skript, länkar, bilder,
// stilmallar eller animationer.

const FENCE = /```svg[ \t]*\r?\n([\s\S]*?)```/gi;
const MAX_SVG_CHARS = 30000;
const FORBIDDEN = [
  [/<script/i, '<script>'],
  [/<foreignobject/i, '<foreignObject>'],
  [/<(iframe|object|embed)\b/i, 'embedded content'],
  [/<image\b/i, '<image>'],
  [/<use\b/i, '<use>'],
  [/<a[\s>]/i, 'links (<a>)'],
  [/<style/i, '<style>'],
  [/<(animate\w*|set)\b/i, 'animation'],
  [/\bon[a-z]+\s*=/i, 'event handlers (on…=)'],
  [/javascript:/i, 'javascript:'],
  [/data:/i, 'data: URLs'],
  [/\bhref\s*=/i, 'href'],
  [/url\s*\(/i, 'url(…)'],
  [/@import/i, '@import'],
  [/<!(entity|doctype)/i, 'DOCTYPE/ENTITY']
];

/** Problem med SVG-figurerna i en text (tom lista = allt ok). */
function figureProblems(text) {
  if (typeof text !== 'string' || !/```svg/i.test(text)) return [];
  const problems = [];
  const blocks = [...text.matchAll(FENCE)];
  if ((text.match(/```svg/gi) || []).length > blocks.length) problems.push('an ```svg block is not closed with ```');
  for (const m of blocks) {
    const svg = m[1].trim();
    if (svg.length > MAX_SVG_CHARS) {
      problems.push(`an svg block is ${svg.length} characters (max ${MAX_SVG_CHARS}) — simplify the drawing`);
    } else if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) {
      problems.push('an svg block must contain exactly one <svg>…</svg> element and nothing else');
    } else {
      const hit = FORBIDDEN.find(([re]) => re.test(svg));
      if (hit) problems.push(`an svg block contains ${hit[1]}, which is not allowed`);
    }
  }
  return problems;
}

module.exports = { figureProblems, MAX_SVG_CHARS };
