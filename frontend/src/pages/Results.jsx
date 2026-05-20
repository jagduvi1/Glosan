import { useLocation, useNavigate, Link, useParams } from 'react-router-dom';
import GloAvatar from '../components/GloAvatar';
import StatTile from '../components/StatTile';

export default function Results() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();

  if (!state) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float style={{ margin: '0 auto 12px' }} />
        <h2 style={{ marginBottom: 8 }}>Inga resultat att visa</h2>
        <p className="muted" style={{ marginBottom: 18 }}>Kör en quizrunda först.</p>
        <Link to={`/lists/${id}`}><button className="btn btn-primary">Tillbaka till listan</button></Link>
      </div>
    );
  }

  const {
    correct = 0,
    wrong = 0,
    bestStreak = 0,
    wrongOnly = false,
    mode = 'write',
    list,
    wasNewBest = false
  } = state;

  const total = correct + wrong;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const best = list?.bestScore;
  const playAgain = () => navigate(`/lists/${id}/quiz${mode === 'choice' ? '?mode=choice' : ''}`);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
      <div style={{ position: 'relative', display: 'inline-block', margin: '20px 0' }}>
        <GloAvatar size={180} float mood="wink" />
        {wasNewBest && (
          <>
            <img
              src="/assets/star-sticker.svg"
              width="64"
              alt=""
              style={{ position: 'absolute', top: -10, right: -40, transform: 'rotate(18deg)' }}
            />
            <img
              src="/assets/sparkle.svg"
              width="32"
              alt=""
              style={{ position: 'absolute', bottom: 8, left: -32, transform: 'rotate(-12deg)' }}
            />
          </>
        )}
      </div>

      <h1 style={{ fontSize: 52, margin: '8px 0' }}>
        {wasNewBest ? <>Klart! <span className="mark-highlight">Nytt rekord.</span></> : <>Klart! Du krossade det.</>}
      </h1>
      <p className="t-hand muted" style={{ fontSize: 18, margin: '0 0 28px' }}>
        {wrongOnly
          ? 'En omgång med fel-glosor — bra jobbat.'
          : 'Glo behöver lägga sig och vila ögonen.'}
      </p>

      <div className="row" style={{ gap: 14, marginBottom: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
        <StatTile value={correct} label="rätt" color="var(--leaf-soft)" icon="/assets/star-sticker.svg" />
        <StatTile value={wrong} label="att öva på" color="var(--berry-soft)" />
        <StatTile value={`${pct}%`} label="rätt-procent" color="var(--coral-soft)" />
        {bestStreak >= 2 ? (
          <StatTile value={bestStreak} label="längsta svit" color="var(--mustard-soft)" icon="/assets/flame-streak.svg" />
        ) : (
          <StatTile value={total} label="glosor totalt" color="var(--mustard-soft)" />
        )}
      </div>

      {best?.total > 0 && !wrongOnly && (
        <div className="card card-lg" style={{ background: 'var(--sky-soft)', marginBottom: 24, textAlign: 'left' }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>
                ⭐ {best.correct} / {best.total} är ditt rekord
              </h3>
              <p className="t-hand muted" style={{ fontSize: 15, margin: '4px 0 0' }}>
                {wasNewBest
                  ? 'Just satt — kan du slå det igen?'
                  : best.achievedAt
                    ? `Satt ${new Date(best.achievedAt).toLocaleDateString('sv-SE')}.`
                    : ''}
              </p>
            </div>
            {wasNewBest && (
              <span
                className="sticker"
                style={{ background: 'var(--coral)', color: 'var(--paper)', transform: 'rotate(6deg)', fontSize: 14 }}
              >
                +1 rekord
              </span>
            )}
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <button className="btn btn-primary" onClick={playAgain}>En till runda</button>
        <Link to={`/lists/${id}`}><button className="btn">Tillbaka till listan →</button></Link>
      </div>
    </div>
  );
}
