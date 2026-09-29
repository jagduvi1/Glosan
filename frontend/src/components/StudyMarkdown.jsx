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
// KaTeX-typsnitten buntas av Vite och serveras från egen origin (CSP: 'self').

const KATEX = [rehypeKatex, { throwOnError: false, strict: 'ignore', trust: false }];

const baseComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
  ),
  img: ({ alt }) => (alt ? <span className="muted">[{alt}]</span> : null)
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
