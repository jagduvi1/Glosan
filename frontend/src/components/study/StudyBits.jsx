import { useState } from 'react';
import '../../styles/study.css';

// Små delade byggstenar för Plugga: nivå-etikett, uppgiftskod,
// progress-stapel och "Öva"-väljaren (läge + nivå + antal).

export const LEVEL_LABEL = { E: 'Lätt', C: 'Medel', A: 'Svår' };

export function LevelPill({ level }) {
  if (!level) return null;
  return <span className={`level-pill level-${level}`}>{LEVEL_LABEL[level]} · {level}</span>;
}

export function CodeTag({ code }) {
  return <span className="study-code" title="Uppgiftskod — skriv den på pappret om du löser för hand">{code}</span>;
}

export function ProgressBar({ progress }) {
  const total = progress?.total || 0;
  const pct = total ? Math.round(((progress.mastered || 0) / total) * 100) : 0;
  return (
    <div>
      <div className="bar-shell" style={{ height: 14 }}>
        <div className="bar-fill bar-fill-leaf" style={{ width: `${pct}%` }} />
      </div>
      <div className="t-hand muted" style={{ fontSize: 13, marginTop: 4 }}>
        {total === 0 ? 'Inget att öva på än' : `${progress.mastered} av ${total} sitter`}
        {progress?.due > 0 ? ` · ${progress.due} att repetera` : ''}
        {progress?.new > 0 ? ` · ${progress.new} nya` : ''}
      </div>
    </div>
  );
}

const MODES = [
  { key: 'mixed', label: 'Blandat' },
  { key: 'cards', label: 'Kort' },
  { key: 'exercises', label: 'Övningar' },
  { key: 'due', label: 'Repetera' },
  { key: 'wrong', label: 'Bara fel' }
];

/**
 * Välj hur man vill öva: läge, nivåer (tomt = alla) och antal. Anropar
 * onStart({ mode, levels, count }).
 */
export function PracticePicker({ onStart, busy = false, startLabel = 'Börja öva →', hasCards = true, hasExercises = true }) {
  const [mode, setMode] = useState('mixed');
  const [levels, setLevels] = useState([]);
  const [count, setCount] = useState(15);
  const toggleLevel = (l) => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  const levelsApply = mode !== 'cards';

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Hur vill du öva?">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className="chip"
            aria-pressed={mode === m.key}
            disabled={busy || (m.key === 'cards' && !hasCards) || (m.key === 'exercises' && !hasExercises)}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {levelsApply && hasExercises && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Nivå">
          <span className="t-hand muted" style={{ fontSize: 15 }}>Nivå:</span>
          {['E', 'C', 'A'].map((l) => (
            <button key={l} type="button" className="chip" aria-pressed={levels.includes(l)} disabled={busy} onClick={() => toggleLevel(l)}>
              {LEVEL_LABEL[l]} · {l}
            </button>
          ))}
          <span className="t-hand muted" style={{ fontSize: 13 }}>{levels.length ? '' : '(alla)'}</span>
        </div>
      )}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="row t-hand" style={{ gap: 6, fontSize: 15 }}>
          Antal
          <select className="inp" value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 'auto', padding: '6px 10px' }} disabled={busy}>
            {[5, 10, 15, 25, 40].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onStart({ mode, levels, count })}>
          {busy ? 'Startar…' : startLabel}
        </button>
      </div>
    </div>
  );
}

/** Bygg /plugga/ova-URL:en av ett omfång + valen i PracticePicker. */
export function practiceUrl(scope, { mode, levels, count }) {
  const q = new URLSearchParams();
  if (scope.unitIds?.length) q.set('units', scope.unitIds.join(','));
  if (scope.subject) q.set('subject', scope.subject);
  if (scope.group) q.set('group', scope.group);
  if (scope.term) q.set('term', scope.term);
  if (scope.allTerms) q.set('allTerms', '1');
  if (mode) q.set('mode', mode);
  if (levels?.length) q.set('levels', levels.join(','));
  if (count) q.set('count', String(count));
  if (scope.back) q.set('back', scope.back);
  return `/plugga/ova?${q}`;
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  if (m > 0) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${s} s`;
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
