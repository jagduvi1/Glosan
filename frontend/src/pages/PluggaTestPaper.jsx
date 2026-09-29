import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyTestSheet } from '../api/study';
import StudyMarkdown from '../components/StudyMarkdown';
import { pointsText, pointsTotal } from '../components/study/TestBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Övningsprovet på papper: skriv ut, skriv svaren (med frågans kod), fota och
// låt din AI rätta — resultatet (poäng per nivå, uppskattat betyg) hamnar i
// Glosan. Utskriften har bara frågorna, aldrig facit.

export default function PluggaTestPaper() {
  const { id } = useParams();
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useDocumentTitle(data ? `${data.test.title} (papper)` : 'Övningsprov på papper');

  useEffect(() => {
    fetchStudyTestSheet(apiFetch, id).then(setData).catch((e) => setError(e.message));
  }, [apiFetch, id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="t-hand muted">Glo hämtar provet…</p>;

  const { test, questions } = data;
  const askText = `Rätta mitt övningsprov "${test.title}" i Glosan (${questions[0]?.code || test.unit.code}).`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(askText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* texten syns ändå */ }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="no-print stack" style={{ gap: 12 }}>
        <Link to={`/plugga/prov/${test.id}`} className="t-hand" style={{ fontSize: 15 }}>← {test.title}</Link>
        <div className="card" style={{ background: 'var(--sky-soft)' }}>
          <h2 style={{ margin: '0 0 6px' }}>🖨️ Gör provet på papper</h2>
          <ol style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.7 }}>
            <li>Skriv ut provet (eller skriv av frågorna).</li>
            <li>Skriv dina svar och lösningar — med <strong>frågans kod</strong> vid varje svar.</li>
            <li>Fota svaren och skicka dem till din AI med texten nedan. Den rättar, ger tips och sparar resultatet här.</li>
          </ol>
          <div className="card" style={{ padding: 10, background: 'var(--bg-elev)', fontSize: 15 }}>{askText}</div>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>🖨️ Skriv ut</button>
            <button type="button" className="btn" onClick={copy}>{copied ? '✓ Kopierat' : '📋 Kopiera texten'}</button>
          </div>
        </div>
      </div>

      <article className="test-sheet">
        <header className="test-sheet-head">
          <div>
            <div className="t-hand muted">{test.unit.emoji} {test.unit.subjectLabel} · {test.unit.code} {test.unit.title}</div>
            <h1 style={{ margin: '4px 0 0', fontSize: 28 }}>{/^övningsprov/i.test(test.title) ? test.title : `Övningsprov: ${test.title}`}</h1>
          </div>
          <div className="test-sheet-fields">
            <div>Namn: <span className="test-sheet-line" /></div>
            <div>Datum: <span className="test-sheet-line short" /></div>
          </div>
        </header>
        <p style={{ margin: '8px 0 0' }}>
          {questions.length} frågor · {pointsTotal(test.max)} poäng ({pointsText(test.max)} E/C/A)
          {test.timeLimitMin ? ` · Tid: ${test.timeLimitMin} min` : ''}
        </p>
        {test.description && <p style={{ margin: '6px 0 0', whiteSpace: 'pre-line' }}>{test.description}</p>}
        <p className="t-hand muted" style={{ margin: '6px 0 0', fontSize: 14 }}>Poängen skrivs som E/C/A, t.ex. (1/1/0) = en E-poäng och en C-poäng. Skriv frågans kod vid varje svar.</p>

        <ol className="test-sheet-questions">
          {questions.map((q) => (
            <li key={q.itemId}>
              <div className="row between" style={{ gap: 8, alignItems: 'baseline' }}>
                <span className="study-code">{q.code}</span>
                <span className="t-hand">({pointsText(q.points)})</span>
              </div>
              <div style={{ marginTop: 6 }}><StudyMarkdown>{q.prompt}</StudyMarkdown></div>
              {q.answerType === 'choice' ? (
                <ul className="test-sheet-choices">
                  {q.choices.map((c, i) => (
                    <li key={i}><span className="test-sheet-box" aria-hidden="true" /> {String.fromCharCode(65 + i)}. <StudyMarkdown inline>{c}</StudyMarkdown></li>
                  ))}
                </ul>
              ) : q.answerType === 'self' ? (
                <div className="test-sheet-space tall" aria-hidden="true" />
              ) : (
                <div className="test-sheet-space" aria-hidden="true">
                  <div className="test-sheet-answer">Svar: <span className="test-sheet-line" />{q.unitLabel ? ` ${q.unitLabel}` : ''}</div>
                </div>
              )}
            </li>
          ))}
        </ol>
        <footer className="t-hand muted test-sheet-foot">Fota dina svar och be din AI: "Rätta mitt övningsprov i Glosan".</footer>
      </article>
    </div>
  );
}
