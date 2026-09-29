import StudyMarkdown from '../StudyMarkdown';

// Svarskontroller som delas av övningspasset och provet: flerval med flera
// rätta och "ordna". Ordna görs med upp/ned-knappar — fungerar lika bra med
// tumme på mobilen som med tangentbord, till skillnad från dra-och-släpp.

const letter = (i) => String.fromCharCode(65 + i);

/** Flera rätta: `value` = valda index. */
export function MultiChoice({ choices, value = [], onChange, disabled = false }) {
  const toggle = (i) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort((a, b) => a - b));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="t-hand muted" style={{ margin: 0 }}>Flera kan vara rätt — välj alla som stämmer.</p>
      {choices.map((c, i) => {
        const on = value.includes(i);
        return (
          <button
            key={i}
            type="button"
            role="checkbox"
            aria-checked={on}
            className={`btn practice-choice ${on ? 'is-picked' : ''}`}
            onClick={() => toggle(i)}
            disabled={disabled}
          >
            <span className="practice-choice-key">{on ? '✓' : letter(i)}</span>
            <StudyMarkdown inline>{c}</StudyMarkdown>
          </button>
        );
      })}
    </div>
  );
}

/** Ordna: `items` i elevens nuvarande ordning. */
export function OrderList({ items, onChange, disabled = false }) {
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="t-hand muted" style={{ margin: 0 }}>Flytta med pilarna tills ordningen stämmer.</p>
      <ol className="order-list">
        {items.map((it, i) => (
          <li key={it} className="order-item">
            <span className="order-pos" aria-hidden="true">{i + 1}</span>
            <span className="grow" style={{ minWidth: 0 }}><StudyMarkdown inline>{it}</StudyMarkdown></span>
            <button type="button" className="btn btn-sm" onClick={() => move(i, -1)} disabled={disabled || i === 0} aria-label={`Flytta upp: ${it}`}>↑</button>
            <button type="button" className="btn btn-sm" onClick={() => move(i, 1)} disabled={disabled || i === items.length - 1} aria-label={`Flytta ner: ${it}`}>↓</button>
          </li>
        ))}
      </ol>
    </div>
  );
}
