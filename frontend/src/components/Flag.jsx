const KNOWN = new Set(['fr', 'de', 'es', 'uk', 'se']);

export default function Flag({ code, size = '' }) {
  const safe = code && KNOWN.has(code.toLowerCase()) ? code.toLowerCase() : 'se';
  return <span className={`flag flag-${safe} ${size ? 'flag-' + size : ''}`} aria-label={code || 'språk'} />;
}
