import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import '../styles/study.css';

// Renderar AI-skrivet Plugga-innehåll: Markdown med formler i LaTeX ($…$ och
// $$…$$). En enkel radbrytning blir en radbrytning (remark-breaks) — i vanlig
// Markdown blir den ett mellanslag, och korttexter med en rad per sak flöt ihop
// till en enda rad. Formler, kod och figurer påverkas inte.
// Texten kommer från en AI och ska aldrig kunna bli körbar kod:
// - ingen rå HTML (skipHtml),
// - KaTeX utan `trust` (inga \href / \url / \htmlClass),
// - inga externa bilder (CSP:n blockerar dem ändå) — alt-texten visas i stället,
// - länkar bara till https-sidor på andra sajter, med värden utskriven, i ny
//   flik utan referer — relativa länkar och länkar till Glosan själv (t.ex. en
//   /connect-ai-länk i ett delat område) blir vanlig text.
// - figurer (tallinjer, faktorträd …) skrivs som ```svg-kodblock och visas som
//   <img> med en data:-URL: en SVG i en bild kör aldrig skript och hämtar
//   ingenting. Servern kontrollerar dem redan när de sparas; samma spärrar
//   finns här som extra skydd.
// KaTeX-typsnitten buntas av Vite och serveras från egen origin (CSP: 'self').

// maxSize/maxExpand: \rule och \kern kan inte lägga sig över resten av sidan.
const KATEX = [rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false, maxSize: 10, maxExpand: 500 }];

const SVG_FORBIDDEN = [
  /<script/i, /<foreignobject/i, /<(iframe|object|embed)\b/i, /<image\b/i, /<use\b/i, /<a[\s>]/i, /<style/i,
  /<(animate\w*|set)\b/i, /\bon[a-z]+\s*=/i, /javascript:/i, /data:/i, /\bhref\s*=/i, /url\s*\(/i, /@import/i, /<!(entity|doctype)/i
];

/** En figur som data:-URL för <img>, eller null om den inte ser ut som en ren ritning. */
export function svgFigureSrc(raw) {
  let svg = String(raw || '').trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg) || svg.length > 30000) return null;
  if (SVG_FORBIDDEN.some((re) => re.test(svg))) return null;
  const head = svg.slice(0, svg.indexOf('>'));
  if (!/\sxmlns\s*=/.test(head)) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  // Utan width/height ritar webbläsaren en bild-SVG som 300×150 — använd
  // viewBox-storleken för det som saknas (bara det: två height är trasig XML).
  const hasW = /\swidth\s*=/.test(head);
  const hasH = /\sheight\s*=/.test(head);
  if (!hasW || !hasH) {
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
    if (vb) {
      const add = `${hasW ? '' : ` width="${vb[1]}"`}${hasH ? '' : ` height="${vb[2]}"`}`;
      svg = svg.replace(/^<svg/i, `<svg${add}`);
    }
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const textOf = (node) => (node?.type === 'text' ? node.value : (node?.children || []).map(textOf).join(''));

/** En länk i AI-/kompisskrivet innehåll: bara https till en annan sajt blir klickbar. */
function SafeLink({ href, children }) {
  let url = null;
  try { url = new URL(href, window.location.origin); } catch { /* ogiltig — text */ }
  if (!url || url.protocol !== 'https:' || url.origin === window.location.origin) return <span>{children}</span>;
  return (
    <a href={url.href} target="_blank" rel="noopener noreferrer nofollow">
      {children} <span className="muted">({url.host})</span>
    </a>
  );
}

/** "2*3*5" är multiplikation, inte kursiv stil: escapa * mellan siffror (utanför formler och kod). */
export function escapeTimes(text) {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/)
    .map((part, i) => (i % 2 ? part : part.replace(/(\d)\*(?=\d)/g, '$1\\*')))
    .join('');
}

// Korta celler (tal, begrepp) bryts aldrig — tabellen rullar hellre i sidled.
const CELL_SHORT = 24;
const cell = (Tag) => function Cell({ node, children, ...props }) {
  const short = textOf(node).trim().length <= CELL_SHORT;
  return <Tag {...props} className={short ? 'cell-short' : undefined}>{children}</Tag>;
};

const baseComponents = {
  a: SafeLink,
  td: cell('td'),
  th: cell('th'),
  img: ({ alt }) => (alt ? <span className="muted">[{alt}]</span> : null),
  pre: ({ node, children }) => {
    const code = node?.children?.find((c) => c.tagName === 'code');
    const classes = code?.properties?.className || [];
    if (code && classes.includes('language-svg')) {
      const src = svgFigureSrc(textOf(code));
      return src
        ? <img className="study-figure" src={src} alt="Figur" />
        : <p className="muted">[Figuren kunde inte visas]</p>;
    }
    return <pre>{children}</pre>;
  }
};

// Inline: för flervalsalternativ och korta etiketter — inga block-stycken (ett
// nytt stycke börjar på ny rad via .md-p i study.css).
const inlineComponents = { ...baseComponents, p: ({ children }) => <span className="md-p">{children}</span> };

// memo: en provsida har många frågor, och klockan/varje tangenttryck ska inte
// tolka om all Markdown och alla formler.
function StudyMarkdown({ children, inline = false }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={`study-md${inline ? ' study-md-inline' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[KATEX]}
        skipHtml
        components={inline ? inlineComponents : baseComponents}
      >
        {escapeTimes(String(children ?? ''))}
      </ReactMarkdown>
    </Tag>
  );
}

export default memo(StudyMarkdown);
