import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import GloAvatar from '../components/GloAvatar';
import StatTile from '../components/StatTile';

const BADGES = [
  {
    id: 'first-quiz',
    label: 'Första rundan',
    desc: 'Slutfört din första quiz',
    icon: '🎯',
    check: (p) => p.quizzesCompleted >= 1
  },
  {
    id: 'week-warrior',
    label: 'Veckopluggis',
    desc: '5 dagar i rad',
    icon: '🔥',
    check: (p) => (p.streak?.longest ?? 0) >= 5
  },
  {
    id: 'first-100-xp',
    label: 'Första hundralappen',
    desc: 'Tjänat 100 XP',
    icon: '⭐',
    check: (p) => p.xp >= 100
  },
  {
    id: 'half-thousand',
    label: 'Halvtusen',
    desc: 'Tjänat 500 XP',
    icon: '🏅',
    check: (p) => p.xp >= 500
  },
  {
    id: 'perfect-round',
    label: 'Perfekt runda',
    desc: '100 % rätt på en quiz',
    icon: '🎉',
    check: (p) => (p.perfectRounds ?? 0) >= 1
  },
  {
    id: 'list-maker',
    label: 'Listmakare',
    desc: 'Skapat 3 listor',
    icon: '📚',
    check: (p) => (p.totalLists ?? 0) >= 3
  }
];

export default function Profile() {
  const { user } = useAuth();
  const { profile, loading, error } = useGamification();

  if (loading && !profile) return <p className="t-hand muted">Glo letar upp dina rekord…</p>;

  if (error || !profile) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2>Kunde inte hämta profilen</h2>
        <p className="muted">{error || 'Något knasade. Försök ladda om sidan.'}</p>
        <Link to="/lists"><button className="btn btn-primary">Tillbaka till listorna</button></Link>
      </div>
    );
  }

  const initial = (user?.username || '?').trim().charAt(0).toUpperCase();
  const memberSince = new Date(profile.joinedAt).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long' });
  const earnedBadges = BADGES.filter((b) => b.check(profile));
  const xpInLevel = profile.xp - profile.thisLevelAt;
  const xpToNext = profile.nextLevelAt - profile.thisLevelAt;
  const levelPct = xpToNext > 0 ? Math.min(100, Math.round((xpInLevel / xpToNext) * 100)) : 100;
  const accuracy = profile.totalCorrect + profile.totalWrong > 0
    ? Math.round((profile.totalCorrect / (profile.totalCorrect + profile.totalWrong)) * 100)
    : null;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="card card-lg">
        <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <span
            className="avatar"
            style={{ width: 96, height: 96, background: 'var(--coral)', fontSize: 44 }}
          >
            {initial}
          </span>
          <div className="grow" style={{ minWidth: 240 }}>
            <h1 style={{ margin: 0 }}>{user.username}</h1>
            <p className="t-hand muted" style={{ fontSize: 16, margin: '4px 0 12px' }}>
              medlem sedan {memberSince} · {profile.totalLists} {profile.totalLists === 1 ? 'lista' : 'listor'}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="pill" style={{ background: 'var(--sky-soft)' }}>
                <img src="/assets/flame-streak.svg" width="14" height="18" alt="" />
                {profile.streak.current} dagars streak
              </span>
              <span className="pill" style={{ background: 'var(--mustard-soft)' }}>
                nivå {profile.level}
              </span>
              <span className="pill" style={{ background: 'var(--leaf-soft)' }}>
                <img src="/assets/star-sticker.svg" width="14" height="14" alt="" />
                {profile.xp} XP
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <StatTile
          value={profile.streak.current}
          label={`längsta: ${profile.streak.longest}`}
          color="var(--sky-soft)"
          icon="/assets/flame-streak.svg"
        />
        <StatTile
          value={profile.totalCorrect}
          label="rätta svar totalt"
          color="var(--leaf-soft)"
          icon="/assets/star-sticker.svg"
        />
        <StatTile
          value={profile.quizzesCompleted}
          label={`${profile.perfectRounds} perfekta`}
          color="var(--coral-soft)"
        />
        <StatTile
          value={accuracy !== null ? `${accuracy}%` : '—'}
          label="rätt-procent"
          color="var(--mustard-soft)"
        />
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>nivå {profile.level}</h3>
          <span className="t-hand muted">
            {xpInLevel} / {xpToNext} XP till nivå {profile.level + 1}
          </span>
        </div>
        <div className="bar-shell">
          <div className="bar-fill bar-fill-mustard" style={{ width: `${levelPct}%` }} />
        </div>
      </div>

      <div>
        <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Märken</h2>
          <span className="t-hand muted">
            {earnedBadges.length} av {BADGES.length} samlade
          </span>
        </div>
        <div className="features-grid">
          {BADGES.map((b, i) => {
            const earned = b.check(profile);
            return (
              <div
                key={b.id}
                className={`card ${i % 2 === 0 ? 'tilt-l' : 'tilt-r'}`}
                style={{
                  background: earned ? 'var(--bg-elev)' : 'var(--paper-edge)',
                  opacity: earned ? 1 : 0.55,
                  textAlign: 'center',
                  padding: 18
                }}
              >
                <div style={{ fontSize: 36 }}>{b.icon}</div>
                <h3 style={{ margin: '6px 0 4px', fontSize: 18 }}>{b.label}</h3>
                <p className="t-hand muted" style={{ fontSize: 13, margin: 0 }}>{b.desc}</p>
                {!earned && (
                  <p className="t-hand" style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--ink-mute)' }}>
                    ej upplåst
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Link to="/lists"><button className="btn btn-primary">Tillbaka till listorna →</button></Link>
      </div>
    </div>
  );
}
