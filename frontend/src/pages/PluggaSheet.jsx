import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudySheet } from '../api/study';
import StudyMarkdown from '../components/StudyMarkdown';
import SheetAnswer from '../components/study/SheetAnswer';
import { LEVEL_LABEL, readScope, scopeQuery } from '../components/study/StudyBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Övningsbladet: samma urval som att öva (omfång, sätt, nivå, antal) men på
// papper — skriv ut, lös, rätta själv med facit (sist, på egna sidor) eller
// fota och låt din AI rätta, så hamnar resultatet i Min plugg. Inget räknas
// förrän något rättats. Mallövningar har en variant ("· v482") så att facit och
// AI:n vet vilka tal just det här bladet har.

const LEVEL_ORDER = ['E', 'C', 'A', null];

// Koden som den står på pappret — och som eleven (eller AI:n) läser av.
const paperCode = (it) => (it.variant ? `${it.code} · v${it.variant}` : it.code);
const askCode = (it) => (it.variant ? `${it.code} v${it.variant}` : it.code);

function SheetHeading({ units }) {
  const one = units.length === 1 ? units[0] : null;
  const subjects = [...new Set(units.map((u) => `${u.emoji} ${u.subjectLabel}`))];
  return (
    <div>
      <div className="t-hand muted">
        {one
          ? `${one.emoji} ${one.subjectLabel} · ${one.code} ${one.title}${one.gradeYear ? ` · åk ${one.gradeYear}` : ''}`
          : `${subjects.join(' · ')} · ${units.map((u) => u.code).join(', ')}`}
      </div>
      <h1 style={{ margin: '4px 0 0', fontSize: 28 }}>Övningsblad{one ? `: ${one.title}` : ''}</h1>
    </div>
  );
}

export default function PluggaSheet() {
  const [params] = useSearchParams();
  const { apiFetch } = useAuth();
  const scope = useMemo(() => readScope(params), [params]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // Redan utskrivna uppgifter: "Nya uppgifter" väljer andra först (utskrift
  // sparar ingen progress, så urvalet blev annars detsamma).
  const [exclude, setExclude] = useState([]);
  const [showHints, setShowHints] = useState(false);
  const [showFacit, setShowFacit] = useState(true);
  const [showSolutions, setShowSolutions] = useState(true);
  const [copied, setCopied] = useState(false);

  const one = data?.units?.length === 1 ? data.units[0] : null;
  useDocumentTitle(one ? `Övningsblad ${one.code} ${one.title}` : 'Övningsblad');

  useEffect(() => {
    let alive = true;
    setError('');
    // Tillbaka-länken hör till sidan, inte till urvalet.
    const query = scopeQuery({ ...scope, back: undefined }, scope);
    if (exclude.length) query.set('exclude', exclude.join(','));
    fetchStudySheet(apiFetch, query)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [apiFetch, scope, exclude]);

  if (error) {
    return (
      <div className="stack" style={{ gap: 12 }}>
        <Link to={scope.back} className="t-hand" style={{ fontSize: 15 }}>← Tillbaka</Link>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!data) return <p className="t-hand muted">Glo plockar fram uppgifter…</p>;

  // En löpande numrering för hela bladet: kort först, sedan övningarna från lätt till svår.
  const items = data.items.map((it, i) => ({ ...it, n: i + 1 }));
  const cards = items.filter((it) => it.kind === 'card');
  const exercises = items.filter((it) => it.kind !== 'card');
  const groups = LEVEL_ORDER
    .map((level) => ({ level, list: exercises.filter((it) => (it.level || null) === level) }))
    .filter((g) => g.list.length);
  const withHints = exercises.filter((it) => it.hints?.length);
  const perLevel = ['E', 'C', 'A'].map((l) => [l, exercises.filter((it) => it.level === l).length]).filter(([, n]) => n);

  const askText = `Rätta mitt övningsblad i Glosan: ${items.map(askCode).join(', ')}.`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(askText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* texten syns ändå */ }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="no-print sheet-controls stack" style={{ gap: 12 }}>
        <Link to={scope.back} className="t-hand" style={{ fontSize: 15 }}>← Tillbaka</Link>
        <div className="card" style={{ background: 'var(--sky-soft)' }}>
          <h2 style={{ margin: '0 0 6px' }}>🖨️ Öva på papper</h2>
          <ol style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.7 }}>
            <li>Skriv ut bladet. Facit hamnar sist, på egna sidor — lägg undan dem tills du är klar.</li>
            <li>Lös uppgifterna på pappret.</li>
            <li>Rätta själv med facit — eller fota bladet och skicka det till din AI med texten nedan. Då rättar den, ger tips och sparar resultatet i Min plugg.</li>
          </ol>
          <div className="card" style={{ padding: 10, background: 'var(--bg-elev)', fontSize: 15 }}>{askText}</div>
          <div className="row" style={{ gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showHints} onChange={(e) => setShowHints(e.target.checked)} disabled={!withHints.length} />
              Ledtrådar{withHints.length ? '' : ' (inga)'}
            </label>
            <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showFacit} onChange={(e) => setShowFacit(e.target.checked)} />
              Facit
            </label>
            <label className="row" style={{ gap: 6, cursor: showFacit ? 'pointer' : 'default' }}>
              <input type="checkbox" checked={showSolutions} onChange={(e) => setShowSolutions(e.target.checked)} disabled={!showFacit} />
              Lösningar i facit
            </label>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>🖨️ Skriv ut</button>
            <button type="button" className="btn" onClick={copy}>{copied ? '✓ Kopierat' : '📋 Kopiera texten'}</button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setExclude((prev) => [...new Set([...prev, ...data.items.map((it) => it.id)])].slice(-100))}
              title="Andra uppgifter än de du redan skrivit ut, när det finns fler — och nya tal i mallövningarna"
            >
              🎲 Nya uppgifter
            </button>
          </div>
        </div>
      </div>

      <article className="test-sheet">
        <header className="test-sheet-head">
          <SheetHeading units={data.units} />
          <div className="test-sheet-fields">
            <div>Namn: <span className="test-sheet-line" /></div>
            <div>Datum: <span className="test-sheet-line short" /></div>
          </div>
        </header>
        <p style={{ margin: '8px 0 0' }}>
          {exercises.length > 0 && `${exercises.length} övningar${perLevel.length ? ` (${perLevel.map(([l, n]) => `${n} ${l}`).join(', ')})` : ''}`}
          {exercises.length > 0 && cards.length > 0 && ' · '}
          {cards.length > 0 && `${cards.length} kort`}
        </p>
        <p className="t-hand muted" style={{ margin: '6px 0 0', fontSize: 14 }}>Löser du på ett eget papper: skriv uppgiftens kod vid varje svar.</p>

        {cards.length > 0 && (
          <section>
            <h2 className="sheet-section">Kort</h2>
            <ol className="test-sheet-questions">
              {cards.map((it) => (
                <li key={it.id} value={it.n}>
                  <span className="study-code">{paperCode(it)}</span>
                  <div style={{ marginTop: 6 }}><StudyMarkdown>{it.prompt}</StudyMarkdown></div>
                  <div className="test-sheet-space short" aria-hidden="true">
                    <div className="test-sheet-answer">Svar: <span className="test-sheet-line" /></div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {groups.map((g) => (
          <section key={g.level || 'none'}>
            <h2 className="sheet-section">
              {g.level ? <span className={`level-pill level-${g.level}`}>{LEVEL_LABEL[g.level]} · {g.level}</span> : 'Övningar'}
            </h2>
            <ol className="test-sheet-questions">
              {g.list.map((it) => (
                <li key={it.id} value={it.n}>
                  <span className="study-code">{paperCode(it)}</span>
                  <div style={{ marginTop: 6 }}><StudyMarkdown>{it.prompt}</StudyMarkdown></div>
                  <SheetAnswer q={it} />
                </li>
              ))}
            </ol>
          </section>
        ))}

        {showHints && withHints.length > 0 && (
          <section className="sheet-hints">
            <h2 className="sheet-section">💡 Ledtrådar</h2>
            <p className="t-hand muted" style={{ margin: '4px 0 0', fontSize: 14 }}>Titta bara om du kör fast.</p>
            <ol className="test-sheet-questions">
              {withHints.map((it) => (
                <li key={it.id} value={it.n}>
                  <span className="study-code">{paperCode(it)}</span>
                  <ul className="sheet-hint-list">
                    {it.hints.map((h, i) => <li key={i}><StudyMarkdown inline>{h}</StudyMarkdown></li>)}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}

        {showFacit && (
          <section className="sheet-facit">
            <h2 className="sheet-section">✓ Facit</h2>
            <ol className="test-sheet-questions">
              {items.map((it) => (
                <li key={it.id} value={it.n}>
                  <span className="study-code">{paperCode(it)}</span>{' '}
                  {it.answerType === 'self'
                    ? <div className="sheet-facit-answer"><span className="t-hand muted">Modellsvar: </span><StudyMarkdown>{it.facit.answer}</StudyMarkdown></div>
                    : <div className="sheet-facit-answer"><StudyMarkdown>{it.facit.answer}</StudyMarkdown></div>}
                  {showSolutions && it.facit.solution && (
                    <div className="sheet-facit-solution"><StudyMarkdown>{it.facit.solution}</StudyMarkdown></div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
        <footer className="t-hand muted test-sheet-foot">Fota bladet och be din AI: "Rätta mitt övningsblad i Glosan" — då sparas resultatet i Min plugg.</footer>
      </article>
    </div>
  );
}
