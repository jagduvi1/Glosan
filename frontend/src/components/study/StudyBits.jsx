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
  { key: 'wrong', label: 'Bara fel' },
  { key: 'ladder', label: '🪜 Nivåstege', title: 'Börja på din nivå — 3 rätt i rad tar dig upp, 2 fel i rad ner' }
];

/**
 * Välj hur man vill öva: läge, nivåer (tomt = alla) och antal. Anropar
 * onStart({ mode, levels, count }).
 */
// onPrint (valfri): samma val som ett övningsblad att skriva ut — inte i
// nivåstegen, som väljer nästa uppgift efter varje svar.
export function PracticePicker({ onStart, onPrint = null, busy = false, startLabel = 'Börja öva →', hasCards = true, hasExercises = true }) {
  const [mode, setMode] = useState('mixed');
  const [levels, setLevels] = useState([]);
  const [count, setCount] = useState(15);
  const toggleLevel = (l) => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));
  const levelsApply = mode !== 'cards' && mode !== 'ladder';

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Hur vill du öva?">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className="chip"
            aria-pressed={mode === m.key}
            title={m.title}
            disabled={busy || (m.key === 'cards' && !hasCards) || ((m.key === 'exercises' || m.key === 'ladder') && !hasExercises)}
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
        {onPrint && (
          <button
            type="button"
            className="btn"
            disabled={busy || mode === 'ladder'}
            title={mode === 'ladder' ? 'Nivåstegen väljer nästa uppgift efter varje svar — välj ett annat sätt att skriva ut' : 'Ett övningsblad med facit att lösa på papper'}
            onClick={() => onPrint({ mode, levels, count })}
          >
            🖨️ Skriv ut
          </button>
        )}
      </div>
    </div>
  );
}

/** Ett omfång + valen i PracticePicker som URL-parametrar (samma för att öva och skriva ut). */
export function scopeQuery(scope, { mode, levels, count, skill } = {}) {
  const q = new URLSearchParams();
  if (scope.unitIds?.length) q.set('units', scope.unitIds.join(','));
  if (scope.folderId) q.set('folder', scope.folderId);
  if (scope.subject) q.set('subject', scope.subject);
  if (scope.group) q.set('group', scope.group);
  if (scope.term) q.set('term', scope.term);
  if (scope.allTerms) q.set('allTerms', '1');
  if (mode) q.set('mode', mode);
  if (levels?.length) q.set('levels', levels.join(','));
  if (skill) q.set('skill', skill);
  if (count) q.set('count', String(count));
  if (scope.back) q.set('back', scope.back);
  return q;
}

/** Bygg /plugga/ova-URL:en av ett omfång + valen i PracticePicker. */
export const practiceUrl = (scope, opts) => `/plugga/ova?${scopeQuery(scope, opts)}`;

/** Övningsbladet (utskrift) för samma omfång och val. */
export const sheetUrl = (scope, opts) => `/plugga/skriv-ut?${scopeQuery(scope, opts)}`;

/** Bara en sökväg i appen ("/plugga/…") — aldrig en annan sajt ("https://…", "//…"). */
export function safeBack(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/plugga';
}

/** Omfånget och valen ur /plugga/ova- och /plugga/skriv-ut-URL:en. */
export function readScope(params) {
  const list = (k) => (params.get(k) ? params.get(k).split(',').filter(Boolean) : undefined);
  return {
    unitIds: list('units'),
    folderId: params.get('folder') || undefined,
    subject: params.get('subject') || undefined,
    group: params.get('group') || undefined,
    term: params.get('term') || undefined,
    allTerms: params.get('allTerms') === '1',
    mode: params.get('mode') || 'mixed',
    levels: list('levels'),
    skill: params.get('skill') || undefined,
    count: Number(params.get('count')) || 15,
    back: safeBack(params.get('back'))
  };
}

/** Nivåstegen E → C → A med aktuell nivå markerad. */
export function LadderSteps({ levels = ['E', 'C', 'A'], level, reached }) {
  const order = ['E', 'C', 'A'];
  return (
    <div className="ladder-steps" aria-label={`Nivåstege: du är på ${LEVEL_LABEL[level] || level}`}>
      {order.filter((l) => levels.includes(l)).map((l, i) => (
        <span key={l} className="row" style={{ gap: 6, alignItems: 'center' }}>
          {i > 0 && <span aria-hidden="true" className="muted">→</span>}
          <span className={`ladder-step level-${l} ${l === level ? 'is-current' : ''} ${order.indexOf(l) <= order.indexOf(reached) ? 'is-reached' : ''}`}>
            {LEVEL_LABEL[l]} · {l}
          </span>
        </span>
      ))}
    </div>
  );
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  if (m > 0) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  return `${s} s`;
}

/** Pluggtid avrundad till minuter: "25 min", "1 h 5 min", "< 1 min". */
export function formatMinutes(sec) {
  const s = Math.round(sec || 0);
  if (s <= 0) return '0 min';
  const m = Math.round(s / 60);
  if (m < 1) return '< 1 min';
  if (m >= 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${m} min`;
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
