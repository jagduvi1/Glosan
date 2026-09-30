import StudyMarkdown from '../StudyMarkdown';

// Svarsutrymmet på papper, efter uppgiftens typ — för övningsprovet
// (PluggaTestPaper) och övningsbladet (PluggaSheet).

export const letter = (i) => String.fromCharCode(65 + i);

export default function SheetAnswer({ q }) {
  if (q.answerType === 'choice' || q.answerType === 'multi') {
    return (
      <>
        {q.answerType === 'multi' && <p className="t-hand muted" style={{ margin: '6px 0 0', fontSize: 14 }}>Flera kan vara rätt — kryssa alla som stämmer.</p>}
        <ul className="test-sheet-choices">
          {q.choices.map((c, i) => (
            <li key={i}><span className="test-sheet-box" aria-hidden="true" /> {letter(i)}. <StudyMarkdown inline>{c}</StudyMarkdown></li>
          ))}
        </ul>
      </>
    );
  }
  if (q.answerType === 'order') {
    return (
      <>
        <ul className="test-sheet-choices">
          {q.items.map((c, i) => <li key={i}>{letter(i)}. <StudyMarkdown inline>{c}</StudyMarkdown></li>)}
        </ul>
        <div className="test-sheet-space short" aria-hidden="true">
          <div className="test-sheet-answer">Rätt ordning (bokstäver): <span className="test-sheet-line" /></div>
        </div>
      </>
    );
  }
  if (q.answerType === 'self') return <div className="test-sheet-space tall" aria-hidden="true" />;
  return (
    <div className="test-sheet-space" aria-hidden="true">
      <div className="test-sheet-answer">
        Svar: <span className="test-sheet-line" />{q.unitLabel ? ` ${q.unitLabel}` : ''}
        {q.answerType === 'factors' && <span className="t-hand muted" style={{ fontSize: 13 }}> (faktorerna med · emellan)</span>}
      </div>
    </div>
  );
}
