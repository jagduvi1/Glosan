import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { updateAvatar, getMyPlan, startMyTrial, exportMyData, deleteMyAccount } from '../api/me';
import GloAvatar from '../components/GloAvatar';
import StatTile from '../components/StatTile';
import AvatarDisplay from '../components/AvatarDisplay';
import AvatarPicker from '../components/AvatarPicker';
import Flag from '../components/Flag';
import { LANG_TO_FLAG, nameForLang } from '../utils/lang';
import { useDocumentTitle } from '../utils/useDocumentTitle';

function daysUntil(iso) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

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
  useDocumentTitle('Profil');
  const { user, apiFetch, logout } = useAuth();
  const { profile, loading, error, refresh } = useGamification();
  const navigate = useNavigate();
  const [showPicker, setShowPicker] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState('');
  const [trialBusy, setTrialBusy] = useState(false);
  const [rightsError, setRightsError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadPlan = useCallback(async () => {
    try {
      const data = await getMyPlan(apiFetch);
      setPlan(data);
    } catch (e) {
      setPlanError(e.message);
    }
  }, [apiFetch]);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  const onSelectAvatar = async (next) => {
    setAvatarError('');
    try {
      await updateAvatar(apiFetch, next);
      refresh();
    } catch (e) {
      setAvatarError(e.message);
    }
  };

  const onStartTrial = async () => {
    setPlanError('');
    setTrialBusy(true);
    try {
      await startMyTrial(apiFetch);
      await loadPlan();
    } catch (e) {
      setPlanError(e.message);
    } finally {
      setTrialBusy(false);
    }
  };

  const onExport = async () => {
    setRightsError('');
    setExportBusy(true);
    try {
      const data = await exportMyData(apiFetch);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `glosan-export-${user.username}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setRightsError(e.message);
    } finally {
      setExportBusy(false);
    }
  };

  const onDelete = async () => {
    if (deleteConfirmText !== user.username) return;
    setRightsError('');
    setDeleteBusy(true);
    try {
      await deleteMyAccount(apiFetch);
      await logout();
      navigate('/login', { replace: true });
    } catch (e) {
      setRightsError(e.message);
      setDeleteBusy(false);
    }
  };

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
          <div style={{ position: 'relative' }}>
            <AvatarDisplay
              avatar={profile.avatar}
              username={user.username}
              size={96}
              style={{ fontSize: 44 }}
            />
            <button
              onClick={() => setShowPicker(true)}
              className="btn btn-sm"
              style={{
                position: 'absolute',
                bottom: -8,
                right: -8,
                padding: '4px 10px',
                fontSize: 12,
                background: 'var(--mustard)'
              }}
            >
              Byt
            </button>
          </div>
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
            {avatarError && <p className="error" style={{ marginTop: 8 }}>{avatarError}</p>}
          </div>
        </div>
      </div>

      {plan && (
        <div className="card" style={{ background: `var(--${plan.effectivePlan.color}-soft, var(--paper-edge))` }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div className="t-hand muted" style={{ fontSize: 15 }}>Din plan</div>
              <h3 style={{ margin: '2px 0 4px', fontSize: 22 }}>
                {plan.effectivePlan.label}
                {plan.trial.active && (
                  <span className="pill" style={{ background: 'var(--mustard-soft)', marginLeft: 10, fontSize: 13 }}>
                    trial · {daysUntil(plan.trial.until)} {daysUntil(plan.trial.until) === 1 ? 'dag' : 'dagar'} kvar
                  </span>
                )}
              </h3>
              <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>
                {plan.effectivePlan.aiCallsPerMonth === null
                  ? 'Obegränsade AI-anrop varje månad.'
                  : `${plan.effectivePlan.aiCallsPerMonth} AI-anrop per månad.`}
              </p>
            </div>
            {!plan.trial.active && !plan.hasUsedTrial && plan.effectivePlan.id !== 'premium' && (
              <button
                className="btn btn-primary"
                onClick={onStartTrial}
                disabled={trialBusy}
              >
                {trialBusy ? 'Startar…' : 'Prova premium gratis i 7 dagar'}
              </button>
            )}
            {!plan.trial.active && plan.hasUsedTrial && plan.effectivePlan.id !== 'premium' && (
              <span className="t-hand muted" style={{ fontSize: 13 }}>
                Trial använd. Premium kommer snart.
              </span>
            )}
          </div>
          {plan.aiUsage.limit !== null && (
            <div style={{ marginTop: 12 }}>
              <div className="row between" style={{ marginBottom: 4 }}>
                <span className="t-hand muted" style={{ fontSize: 13 }}>AI-anrop denna månad</span>
                <span className="t-hand muted" style={{ fontSize: 13 }}>
                  {plan.aiUsage.used} / {plan.aiUsage.limit}
                </span>
              </div>
              <div className="bar-shell">
                <div
                  className="bar-fill bar-fill-coral"
                  style={{
                    width: `${Math.min(100, Math.round((plan.aiUsage.used / plan.aiUsage.limit) * 100))}%`
                  }}
                />
              </div>
            </div>
          )}
          {planError && <p className="error" style={{ marginTop: 10 }}>{planError}</p>}
        </div>
      )}

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
        {profile.referralCount > 0 && (
          <StatTile
            value={profile.referralCount}
            label={profile.referralCount === 1 ? 'kompis bjuden' : 'kompisar bjudna'}
            color="var(--plum-soft)"
          />
        )}
      </div>

      {(profile.unlockedRewards?.length > 0 || profile.referralCount > 0) && (
        <div className="card" style={{ background: 'var(--plum-soft)' }}>
          <h3 style={{ marginTop: 0, marginBottom: 10 }}>🎁 Belöningar för inbjudna kompisar</h3>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span
              className="pill"
              style={{
                background: profile.unlockedRewards?.includes('student-hat') ? 'var(--mustard)' : 'var(--paper-deep)',
                opacity: profile.unlockedRewards?.includes('student-hat') ? 1 : 0.6
              }}
              title="3 inbjudna kompisar"
            >
              🎓 Studentmössa {profile.unlockedRewards?.includes('student-hat') ? '✓' : `(${Math.min(profile.referralCount, 3)}/3)`}
            </span>
            <span
              className="pill"
              style={{
                background: profile.unlockedRewards?.includes('ambassador') ? 'var(--coral)' : 'var(--paper-deep)',
                color: profile.unlockedRewards?.includes('ambassador') ? 'var(--paper)' : 'var(--ink)',
                opacity: profile.unlockedRewards?.includes('ambassador') ? 1 : 0.6
              }}
              title="10 inbjudna kompisar"
            >
              ⭐ Ambassadör {profile.unlockedRewards?.includes('ambassador') ? '✓' : `(${Math.min(profile.referralCount, 10)}/10)`}
            </span>
          </div>
          <p className="t-hand muted" style={{ fontSize: 14, margin: '10px 0 0' }}>
            Bjud in fler via dina engångskoder under <a href="/kompisar">Kompisar</a> — ni får båda 100 XP per kompis.
          </p>
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <h3 style={{ margin: 0 }}>Totalt — nivå {profile.level}</h3>
            <span className="t-hand muted" style={{ fontSize: 14 }}>låser upp profilbilder</span>
          </div>
          <span className="t-hand muted">
            {xpInLevel} / {xpToNext} XP till nivå {profile.level + 1}
          </span>
        </div>
        <div className="bar-shell">
          <div className="bar-fill bar-fill-mustard" style={{ width: `${levelPct}%` }} />
        </div>
      </div>

      {Object.keys(profile.languageXp || {}).length > 0 && (
        <div>
          <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Per språk</h2>
            <span className="t-hand muted">
              {Object.keys(profile.languageXp).length} {Object.keys(profile.languageXp).length === 1 ? 'språk' : 'språk'} aktiva
            </span>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {Object.entries(profile.languageXp)
              .sort(([, a], [, b]) => b.xp - a.xp)
              .map(([lang, info]) => {
                const flag = LANG_TO_FLAG[lang];
                const langXpInLevel = info.xp - info.thisLevelAt;
                const langXpToNext = info.nextLevelAt - info.thisLevelAt;
                const langPct = langXpToNext > 0 ? Math.min(100, Math.round((langXpInLevel / langXpToNext) * 100)) : 100;
                return (
                  <div key={lang} className="card" style={{ padding: 16 }}>
                    <div className="row between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                      <div className="row" style={{ gap: 10 }}>
                        {flag && <Flag code={flag} size="lg" />}
                        <h3 style={{ margin: 0 }}>{nameForLang(lang)}</h3>
                        <span className="pill" style={{ background: 'var(--mustard-soft)' }}>nivå {info.level}</span>
                        <span className="pill" style={{ background: 'var(--leaf-soft)' }}>{info.xp} XP</span>
                      </div>
                      <span className="t-hand muted">
                        {langXpInLevel} / {langXpToNext} XP till nivå {info.level + 1}
                      </span>
                    </div>
                    <div className="bar-shell">
                      <div className="bar-fill bar-fill-coral" style={{ width: `${langPct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

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

      <div className="card" style={{ background: 'var(--paper-edge)' }}>
        <h2 style={{ marginTop: 0 }}>Mina rättigheter</h2>
        <p className="t-hand muted" style={{ fontSize: 15, marginTop: 0 }}>
          Du kan när som helst ladda ner din data eller radera kontot. Läs mer i vår{' '}
          <Link to="/integritet">integritetspolicy</Link>.
        </p>
        {rightsError && <p className="error">{rightsError}</p>}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={onExport} disabled={exportBusy}>
            {exportBusy ? 'Hämtar…' : 'Ladda ner min data (JSON)'}
          </button>
          <button
            className="btn"
            style={{ background: 'var(--berry-soft)', color: 'var(--berry-deep)' }}
            onClick={() => { setShowDeleteConfirm(true); setDeleteConfirmText(''); }}
          >
            Radera mitt konto
          </button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Link to="/lists"><button className="btn btn-primary">Tillbaka till listorna →</button></Link>
      </div>

      {showDeleteConfirm && (
        <div className="modal-backdrop" onClick={() => !deleteBusy && setShowDeleteConfirm(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>Radera kontot?</h3>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteBusy}
                aria-label="Stäng"
              >
                ×
              </button>
            </div>
            <div className="modal-body stack">
              <p>
                Allt försvinner direkt: dina <strong>listor</strong>, <strong>glosor</strong>,
                <strong> kompis-kopplingar</strong>, <strong>XP</strong> och <strong>profil</strong>.
                Detta går inte att ångra.
              </p>
              <label className="field">
                <span className="field-label">
                  Skriv ditt användarnamn <strong>{user.username}</strong> för att bekräfta
                </span>
                <input
                  className="inp"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  disabled={deleteBusy}
                />
              </label>
              <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleteBusy}
                >
                  Avbryt
                </button>
                <button
                  className="btn"
                  style={{ background: 'var(--berry)', color: 'var(--paper)' }}
                  onClick={onDelete}
                  disabled={deleteBusy || deleteConfirmText !== user.username}
                >
                  {deleteBusy ? 'Raderar…' : 'Radera permanent'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <AvatarPicker
          currentAvatar={profile.avatar}
          username={user.username}
          userLevel={profile.level}
          onSelect={onSelectAvatar}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
