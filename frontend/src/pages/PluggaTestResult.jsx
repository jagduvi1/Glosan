import { useState, useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchStudyTestAttempt } from '../api/study';
import StudyMarkdown from '../components/StudyMarkdown';
import { CodeTag } from '../components/study/StudyBits';
import { PointsLabel, GradeBadge, LevelBars, LimitsText } from '../components/study/TestBits';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import '../styles/study.css';

// Resultatet av ett övningsprov — gjort i appen eller på papper (rättat av
// elevens AI). Poäng per nivå, uppskattat betyg och facit fråga för fråga.

const RESULT_ICON = { correct: '✓', partial: '≈', wrong: '✗' };
const RESULT_TEXT = { correct: 'Rätt', partial: 'Delvis', wrong: 'Inte rätt' };
const SELF_TEXT = { none: 'inte än', E: 'E-nivå', C: 'C-nivå', A: 'A-nivå' };

export default function PluggaTestResult() {
  const { id, attemptId } = useParams();
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useDocumentTitle(data?.testTitle ? `Resultat: ${data.testTitle}` : 'Provresultat');

  useEffect(() => {
    fetchStudyTestAttempt(apiFetch, attemptId).then(setData).catch((e) => setError(e.message));
  }, [apiFetch, attemptId]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="t-hand muted">Glo räknar poängen…</p>;
  if (data.status !== 'done') return <Navigate to={`/plugga/prov/${data.testId || id}`} replace />;

  const date = new Date(data.finishedAt).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <Link to={`/plugga/omrade/${data.unitId}`} className="t-hand" style={{ fontSize: 15 }}>← {data.emoji} {data.unitTitle}</Link>
        <h1 style={{ fontSize: 32, margin: '6px 0 0' }}>📝 {data.testTitle}</h1>
        <p className="t-hand muted" style={{ margin: '2px 0 0' }}>
          {date} · {data.source === 'paper' ? '📷 gjort på papper, rättat av din AI' : 'gjort i appen'}
        </p>
      </div>

      <div className="card card-lg">
        <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <GradeBadge grade={data.grade} />
          <div className="grow" style={{ minWidth: 200 }}>
            <div className="t-hand muted">Uppskattat betyg</div>
            <div style={{ fontFamily: 'var(--font-headline)', fontSize: 30, lineHeight: 1.1 }}>
              {data.score.total} av {data.max.total} poäng
            </div>
            {data.xpEarned > 0 && <span className="pill" style={{ background: 'var(--mustard-soft)', marginTop: 6 }}>+{data.xpEarned} XP</span>}
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <LevelBars score={data.score} max={data.max} />
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="t-hand" style={{ cursor: 'pointer' }}>Hur räknas betyget?</summary>
          <LimitsText limits={data.limits} max={data.max} />
        </details>
        <p className="t-hand muted" style={{ margin: '10px 0 0', fontSize: 14 }}>Bara en uppskattning — det är läraren som sätter betyg.</p>
      </div>

      {data.overallFeedback && (
        <div className="card" style={{ background: 'var(--sky-soft)' }}>
          <div className="t-hand muted" style={{ fontSize: 14, marginBottom: 4 }}>Din AI:s kommentar</div>
          <StudyMarkdown>{data.overallFeedback}</StudyMarkdown>
        </div>
      )}

      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>Fråga för fråga</h3>
        {data.answers.map((a) => (
          <div key={a.n} className="unit-item">
            <div className="row between" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong>{a.n}.</strong>
                <CodeTag code={a.code} />
                <PointsLabel points={a.max} />
              </div>
              <span style={{ fontWeight: 800, color: a.result === 'correct' ? 'var(--leaf-deep)' : a.result === 'partial' ? 'var(--mustard-deep)' : 'var(--berry-deep)' }}>
                {RESULT_ICON[a.result]} {RESULT_TEXT[a.result]} · {a.points.total} p
              </span>
            </div>
            {a.prompt && <div style={{ marginTop: 8 }}><StudyMarkdown>{a.prompt}</StudyMarkdown></div>}
            <p style={{ margin: '8px 0 0' }}>
              <span className="t-hand muted">Ditt svar: </span>
              {a.given ? <span style={{ whiteSpace: 'pre-wrap' }}>{a.given}</span> : <span className="t-hand muted">(inget svar)</span>}
              {a.selfLevel && <span className="t-hand muted"> · du bedömde: {SELF_TEXT[a.selfLevel]}</span>}
            </p>
            {a.result !== 'correct' && a.expected && (
              <p style={{ margin: '4px 0 0' }}><span className="t-hand muted">Rätt svar: </span><strong><StudyMarkdown inline>{a.expected}</StudyMarkdown></strong></p>
            )}
            {a.feedback && (
              <div className="card" style={{ padding: 10, marginTop: 8, background: 'var(--sky-soft)' }}>
                <StudyMarkdown>{a.feedback}</StudyMarkdown>
              </div>
            )}
            {(a.solution || a.modelAnswer) && (
              <details style={{ marginTop: 8 }} open={a.result !== 'correct' && !a.feedback}>
                <summary style={{ cursor: 'pointer', fontWeight: 800 }}>{a.solution ? 'Så löser man den' : 'Modellsvar'}</summary>
                <div style={{ marginTop: 6 }}><StudyMarkdown>{a.solution || a.modelAnswer}</StudyMarkdown></div>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {data.testExists && <Link to={`/plugga/prov/${data.testId}`} className="btn btn-primary">Gör om provet</Link>}
        <Link to={`/plugga/omrade/${data.unitId}`} className="btn">Öva på området</Link>
        <Link to="/plugga/min-plugg" className="btn btn-ghost">📊 Min plugg</Link>
      </div>
    </div>
  );
}
