import { Link } from 'react-router-dom';
import { ProgressBar, daysUntil } from './StudyBits';

// Ett område som kort i en lista (ämnessidan, en mapp). Med `onToggle` får
// kortet en kryssruta för att välja det; `showSubject` visar ämne och termin
// (när listan blandar ämnen, som i en mapp); `action` hamnar uppe till höger.
export default function UnitCard({ unit, selected = false, onToggle, showSubject = false, action = null }) {
  const days = daysUntil(unit.examDate);
  const meta = [
    showSubject ? `${unit.emoji} ${unit.subjectLabel}` : null,
    showSubject ? unit.termLabel : null,
    unit.gradeYear ? `åk ${unit.gradeYear}` : null,
    unit.source?.book,
    unit.source?.chapter
  ].filter(Boolean).join(' · ');

  return (
    <div className="card" style={{ padding: 16, outline: selected ? '3px solid var(--coral-deep)' : 'none' }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        {onToggle && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Välj ${unit.title}`}
            style={{ marginTop: 6, width: 20, height: 20, flex: 'none' }}
          />
        )}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
            <Link to={`/plugga/omrade/${unit.id}`} style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span className="study-code">{unit.code}</span>
                <h3 style={{ margin: 0, fontSize: 20 }}>{unit.title}</h3>
              </div>
            </Link>
            {action}
          </div>
          <p className="t-hand muted" style={{ margin: '4px 0 8px', fontSize: 14 }}>
            {meta}
            {unit.sharedBy ? `${meta ? ' · ' : ''}delad av ${unit.sharedBy}` : ''}
          </p>
          <p className="t-hand" style={{ margin: '0 0 8px', fontSize: 14 }}>
            {unit.progress.cards} kort · {unit.progress.exercises} övningar
            {unit.progress.exercises > 0 && ` (${['E', 'C', 'A'].map((l) => `${unit.progress.levels[l]} ${l}`).join(', ')})`}
            {days !== null && days >= 0 && (
              <strong style={{ marginLeft: 8, color: days <= 3 ? 'var(--berry-deep)' : 'inherit' }}>
                · Prov {days === 0 ? 'idag!' : days === 1 ? 'imorgon' : `om ${days} dagar`}
              </strong>
            )}
          </p>
          <ProgressBar progress={unit.progress} />
        </div>
      </div>
    </div>
  );
}
