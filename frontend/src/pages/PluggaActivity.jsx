import { useState, useEffect, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyActivity } from '../api/study';
import StatTile from '../components/StatTile';
// Markdown + KaTeX (~130 kB) behövs bara när en AI-återkoppling fälls ut.
const StudyMarkdown = lazy(() => import('../components/StudyMarkdown'));
import { CodeTag, formatMinutes } from '../components/study/StudyBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// "Min plugg" — vad eleven har gjort idag, en vecka, en månad eller en termin:
// tid, uppgifter och resultat per ämne, vilka dagar, och varje pass med
// uppgifterna. Tänkt att kunna visas (eller skrivas ut) för någon hemma.
// Perioden ligger i URL:en (?p=week&d=2026-09-29), så den går att länka till.

const PERIODS = [
  { key: 'day', label: 'Dag' },
  { key: 'week', label: 'Vecka' },
  { key: 'month', label: 'Månad' },
  { key: 'term', label: 'Termin' }
];
const KIND_LABEL = { practice: 'Övningar', review: 'Repetition', reading: 'Läsning', paper: 'På papper', test: 'Prov' };
const RESULT_ICON = { correct: '✓', partial: '≈', wrong: '✗' };
const RESULT_WORD = { correct: 'rätt', partial: 'delvis rätt', wrong: 'fel' };
const RESULT_COLOR = { correct: 'var(--leaf-deep)', partial: 'var(--mustard-deep)', wrong: 'var(--berry-deep)' };
const WEEKDAYS = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];

// 'YYYY-MM-DD' → lokalt Date (utan tidszonsförskjutning).
const toDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (ymd, opts) => toDate(ymd).toLocaleDateString('sv-SE', opts);
const addDays = (ymd, n) => { const d = toDate(ymd); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ISO-veckonummer (som i svenska almanackor), räknat i UTC så sommartid inte stör.
function isoWeek(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

function periodTitle(a) {
  if (a.period === 'day') {
    if (a.start === a.today) return { title: 'Idag', sub: fmt(a.start, { weekday: 'long', day: 'numeric', month: 'long' }) };
    if (a.start === addDays(a.today, -1)) return { title: 'Igår', sub: fmt(a.start, { weekday: 'long', day: 'numeric', month: 'long' }) };
    return { title: fmt(a.start, { weekday: 'long', day: 'numeric', month: 'long' }), sub: fmt(a.start, { year: 'numeric' }) };
  }
  if (a.period === 'week') {
    const last = addDays(a.end, -1);
    return { title: `Vecka ${isoWeek(a.start)}`, sub: `${fmt(a.start, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}` };
  }
  if (a.period === 'month') {
    const t = fmt(a.start, { month: 'long', year: 'numeric' });
    return { title: t.charAt(0).toUpperCase() + t.slice(1), sub: '' };
  }
  const y = a.start.slice(0, 4);
  return { title: a.start.slice(5, 7) === '07' ? `HT ${y}` : `VT ${y}`, sub: a.start.slice(5, 7) === '07' ? 'juli – december' : 'januari – juni' };
}

// Färgstyrka för en dag: 0 = inget, 4 = en timme eller mer.
function heat(day) {
  const m = (day.activeSeconds || 0) / 60;
  if (m <= 0 && !day.answered) return 0;
  if (m < 10) return 1;
  if (m < 30) return 2;
  if (m < 60) return 3;
  return 4;
}

function dayLink(date) {
  return `/plugga/min-plugg?p=day&d=${date}`;
}

function WeekBars({ days, today }) {
  const max = Math.max(60, ...days.map((d) => d.activeSeconds));
  return (
    <div className="activity-week">
      {days.map((d, i) => {
        const future = d.date > today;
        return (
          <Link key={d.date} to={dayLink(d.date)} className="activity-week-day" aria-label={`${fmt(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${formatMinutes(d.activeSeconds)}`}>
            <div className="activity-week-value t-hand">{d.activeSeconds ? formatMinutes(d.activeSeconds) : future ? '' : '–'}</div>
            <div className="activity-week-track">
              <div className="activity-week-bar" style={{ height: `${Math.round((d.activeSeconds / max) * 100)}%` }} />
            </div>
            <div className={`activity-week-label ${d.date === today ? 'is-today' : ''}`}>{WEEKDAYS[i]}</div>
            <div className="activity-week-emojis" aria-hidden="true">{d.emojis.slice(0, 3).join('')}</div>
          </Link>
        );
      })}
    </div>
  );
}

function MonthCalendar({ days, today }) {
  const lead = (toDate(days[0].date).getDay() + 6) % 7;
  return (
    <div>
      <div className="activity-cal activity-cal-head" aria-hidden="true">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="activity-cal">
        {Array.from({ length: lead }, (_, i) => <div key={`x${i}`} />)}
        {days.map((d) => (
          <Link
            key={d.date}
            to={dayLink(d.date)}
            className={`activity-cal-day heat-${heat(d)} ${d.date === today ? 'is-today' : ''}`}
            aria-label={`${fmt(d.date, { day: 'numeric', month: 'long' })}: ${formatMinutes(d.activeSeconds)}, ${d.answered} uppgifter`}
          >
            <span className="activity-cal-num">{Number(d.date.slice(8))}</span>
            {d.activeSeconds > 0 && <span className="activity-cal-min">{Math.max(1, Math.round(d.activeSeconds / 60))}′</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

function TermHeatmap({ days, today }) {
  const lead = (toDate(days[0].date).getDay() + 6) % 7;
  const cells = [...Array.from({ length: lead }, () => null), ...days];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div className="activity-heatmap" role="img" aria-label="Pluggdagar under terminen">
        {weeks.map((w, wi) => {
          const first = w.find(Boolean);
          const monthStart = first && w.some((d) => d && d.date.endsWith('-01'));
          return (
            <div key={wi} className="activity-heatmap-week">
              <div className="activity-heatmap-month">{monthStart ? fmt(w.find((d) => d && d.date.endsWith('-01')).date, { month: 'short' }) : ''}</div>
              {Array.from({ length: 7 }, (_, di) => {
                const d = w[di];
                if (!d) return <div key={di} className="activity-heatmap-cell is-empty" />;
                return (
                  <Link
                    key={di}
                    to={dayLink(d.date)}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={`activity-heatmap-cell heat-${heat(d)} ${d.date === today ? 'is-today' : ''}`}
                    title={`${fmt(d.date, { day: 'numeric', month: 'short' })}: ${formatMinutes(d.activeSeconds)}`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SessionRow({ s, showDate }) {
  const time = new Date(s.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const summary = (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <div className="activity-when t-hand">
        {showDate && <div>{fmt(s.date, { weekday: 'short', day: 'numeric' })}</div>}
        <div className="muted">{time}</div>
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800 }}>
          <span aria-hidden="true">{s.subjects.map((x) => x.emoji).join(' ')}</span> {KIND_LABEL[s.kind] || 'Plugg'}
          {s.unitTitles.length > 0 && <span className="muted" style={{ fontWeight: 600 }}> · {s.unitTitles.join(', ')}</span>}
        </div>
        {s.test && (
          <Link to={`/plugga/prov/${s.test.testId}/resultat/${s.test.attemptId}`} className="t-hand" style={{ display: 'block', fontSize: 15 }}>
            📝 {s.test.title}: {s.test.score.total} av {s.test.max.total} poäng · uppskattat {s.test.grade}{s.test.source === 'paper' ? ' (på papper)' : ''} ›
          </Link>
        )}
        <div className="t-hand muted" style={{ fontSize: 14 }}>
          {[s.answered ? `${s.answered} ${s.answered === 1 ? 'uppgift' : 'uppgifter'}, ${s.correct} rätt` : null, s.activeSeconds ? formatMinutes(s.activeSeconds) : null]
            .filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    </div>
  );
  if (!s.items.length) return <div className="unit-item">{summary}</div>;
  return (
    <details className="unit-item">
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>{summary}</summary>
      <div className="stack" style={{ gap: 6, margin: '10px 0 0 70px' }}>
        {s.items.map((it, i) => (
          <div key={i}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span role="img" style={{ fontWeight: 900, width: 16, color: RESULT_COLOR[it.result] }} aria-label={RESULT_WORD[it.result]}>{RESULT_ICON[it.result]}</span>
              {it.unitId ? <Link to={`/plugga/omrade/${it.unitId}`} style={{ textDecoration: 'none' }}><CodeTag code={it.code} /></Link> : <CodeTag code={it.code} />}
              {it.source === 'paper' && <span className="t-hand muted" style={{ fontSize: 13 }}>📷 på papper</span>}
              {it.given && it.source !== 'paper' && <span className="t-hand muted" style={{ fontSize: 13 }}>svar: {it.given}</span>}
            </div>
            {it.feedback && (
              <div className="card" style={{ padding: 10, margin: '6px 0 4px 24px', background: 'var(--sky-soft)' }}>
                <Suspense fallback={<p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{it.feedback}</p>}><StudyMarkdown>{it.feedback}</StudyMarkdown></Suspense>
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

export default function PluggaActivity() {
  useDocumentTitle('Min plugg');
  const { apiFetch } = useAuth();
  const [params, setParams] = useSearchParams();
  const period = PERIODS.some((p) => p.key === params.get('p')) ? params.get('p') : 'week';
  const date = params.get('d') || '';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchStudyActivity(apiFetch, { period, date: date || undefined })
      .then((d) => { if (alive) { setData(d); setError(''); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [apiFetch, period, date]);

  // Utskrift: öppna alla pass så att uppgifterna och AI:ns tips kommer med.
  useEffect(() => {
    const open = () => document.querySelectorAll('.activity-page details').forEach((d) => { d.open = true; });
    window.addEventListener('beforeprint', open);
    return () => window.removeEventListener('beforeprint', open);
  }, []);

  const go = (p, d) => setParams(d ? { p, d } : { p });

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="t-hand muted">Glo räknar ihop ditt plugg…</p>;

  const { title, sub } = periodTitle(data);
  const t = data.totals;
  const pct = t.answered ? Math.round((t.correct / t.answered) * 100) : null;
  const maxSubject = Math.max(1, ...data.bySubject.map((s) => s.activeSeconds));
  const empty = t.activeSeconds === 0 && t.answered === 0;

  return (
    <div className="stack activity-page" style={{ gap: 20 }}>
      <div className="row between" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <Link to="/plugga" className="t-hand no-print" style={{ fontSize: 15 }}>← Plugga</Link>
          <h1 style={{ fontSize: 38, margin: '6px 0 0' }}>📊 Min plugg</h1>
          <p className="t-hand muted no-print" style={{ margin: '2px 0 0', fontSize: 16 }}>Allt du har pluggat — visa gärna någon hemma.</p>
        </div>
        <button type="button" className="btn btn-sm no-print" onClick={() => window.print()}>🖨️ Skriv ut</button>
      </div>

      <div className="row between no-print" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className="chip" aria-pressed={period === p.key} onClick={() => go(p.key, date)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => go(period, data.prev)} aria-label="Föregående">‹</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => go(period, data.next)} disabled={!data.next} aria-label="Nästa">›</button>
          {data.anchor !== data.today && (
            <button type="button" className="btn btn-sm" onClick={() => go(period)}>Nu</button>
          )}
        </div>
      </div>

      <div>
        <h2 style={{ margin: 0, fontSize: 28 }}>{title}</h2>
        {sub && <p className="t-hand muted" style={{ margin: 0 }}>{sub}</p>}
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <StatTile value={formatMinutes(t.activeSeconds)} label="pluggtid" color="var(--sky-soft)" compact />
        <StatTile value={t.answered} label={pct === null ? 'uppgifter' : `uppgifter · ${pct} % rätt`} color="var(--leaf-soft)" compact />
        {data.period !== 'day' && <StatTile value={t.daysStudied} label={t.daysStudied === 1 ? 'dag med plugg' : 'dagar med plugg'} color="var(--mustard-soft)" compact />}
        <StatTile value={`+${t.xp}`} label="XP" color="var(--plum-soft)" compact />
        {t.tests > 0 && <StatTile value={t.tests} label="övningsprov" color="var(--berry-soft)" compact />}
        {data.streak.current > 0 && (
          <StatTile value={`🔥 ${data.streak.current}`} label={data.streak.current === 1 ? 'dag i rad' : 'dagar i rad'} color="var(--coral-soft)" compact />
        )}
      </div>

      {empty ? (
        <div className="card card-lg" style={{ background: 'var(--paper-edge)', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 6px' }}>Inget pluggat {data.period === 'day' ? 'den här dagen' : 'under perioden'} än</h2>
          <p className="t-hand muted" style={{ margin: '0 0 14px' }}>Allt du övar, läser och rättar på papper hamnar här.</p>
          <Link to="/plugga" className="btn btn-primary no-print">Till Plugga</Link>
        </div>
      ) : (
        <>
          {data.bySubject.length > 0 && (
            <div className="card">
              <h3 style={{ margin: '0 0 12px' }}>Per ämne</h3>
              <div className="stack" style={{ gap: 12 }}>
                {data.bySubject.map((s) => (
                  <div key={s.subject}>
                    <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
                      <strong><span aria-hidden="true">{s.emoji}</span> {s.label}</strong>
                      <span className="t-hand muted" style={{ fontSize: 14 }}>
                        {formatMinutes(s.activeSeconds)}{s.answered ? ` · ${s.answered} uppgifter, ${s.correct} rätt` : ''}
                      </span>
                    </div>
                    <div className="bar-shell" style={{ height: 12, marginTop: 4 }}>
                      <div className="bar-fill" style={{ width: `${Math.round((s.activeSeconds / maxSubject) * 100)}%`, background: s.color ? `var(--${s.color})` : 'var(--sky)' }} />
                    </div>
                  </div>
                ))}
              </div>
              {t.paper > 0 && (
                <p className="t-hand muted" style={{ margin: '12px 0 0', fontSize: 14 }}>
                  📷 {t.paper} svar på papper rättade av din AI
                </p>
              )}
            </div>
          )}

          {data.period === 'week' && <div className="card"><WeekBars days={data.days} today={data.today} /></div>}
          {data.period === 'month' && <div className="card"><MonthCalendar days={data.days} today={data.today} /></div>}
          {data.period === 'term' && <div className="card"><TermHeatmap days={data.days} today={data.today} /></div>}

          <div className="card">
            <h3 style={{ margin: '0 0 6px' }}>Vad jag har gjort</h3>
            {data.timeline.kind === 'sessions' ? (
              <>
                {data.timeline.sessions.map((s) => <SessionRow key={s.id} s={s} showDate={data.period !== 'day'} />)}
                {data.timeline.more > 0 && <p className="t-hand muted">…och {data.timeline.more} pass till.</p>}
              </>
            ) : (
              data.timeline.days.map((d) => (
                <Link key={d.date} to={dayLink(d.date)} className="unit-item row between" style={{ gap: 10, color: 'inherit', textDecoration: 'none', display: 'flex' }}>
                  <span style={{ fontWeight: 800 }}>
                    {fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' })} <span aria-hidden="true">{d.emojis.join(' ')}</span>
                  </span>
                  <span className="t-hand muted" style={{ fontSize: 14 }}>
                    {[formatMinutes(d.activeSeconds), d.answered ? `${d.answered} uppgifter, ${d.correct} rätt` : null].filter(Boolean).join(' · ')} ›
                  </span>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
