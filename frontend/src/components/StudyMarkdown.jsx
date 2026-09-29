import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import '../styles/study.css';

// Renderar AI-skrivet Plugga-innehåll: Markdown med formler i LaTeX ($…$ och
// $$…$$). Texten kommer från en AI och ska aldrig kunna bli körbar kod:
// - ingen rå HTML (skipHtml),
// - KaTeX utan `trust` (inga \href / \url / \htmlClass),
// - inga externa bilder (CSP:n blockerar dem ändå) — alt-texten visas i stället,
// - länkar öppnas i ny flik utan referer.
// - figurer (tallinjer, faktorträd …) skrivs som ```svg-kodblock och visas som
//   <img> med en data:-URL: en SVG i en bild kör aldrig skript och hämtar
//   ingenting. Servern kontrollerar dem redan när de sparas; samma spärrar
//   finns här som extra skydd.
// KaTeX-typsnitten buntas av Vite och serveras från egen origin (CSP: 'self').

const KATEX = [rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }];

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
  // Utan width/height ritar webbläsaren en bild-SVG som 300×150 — använd viewBox-storleken.
  if (!/\swidth\s*=/.test(head)) {
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
    if (vb) svg = svg.replace(/^<svg/i, `<svg width="${vb[1]}" height="${vb[2]}"`);
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const textOf = (node) => (node?.type === 'text' ? node.value : (node?.children || []).map(textOf).join(''));

const baseComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
  ),
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

// Inline: för flervalsalternativ och korta etiketter — inga block-stycken.
const inlineComponents = { ...baseComponents, p: ({ children }) => <span>{children}</span> };

export default function StudyMarkdown({ children, inline = false }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={`study-md${inline ? ' study-md-inline' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[KATEX]}
        skipHtml
        components={inline ? inlineComponents : baseComponents}
      >
        {String(children ?? '')}
      </ReactMarkdown>
    </Tag>
  );
}
