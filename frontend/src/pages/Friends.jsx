import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { fetchFriends, addFriendByCode, removeFriend, fetchBlocked, blockUser, unblockUser } from '../api/friends';
import { fetchCoopStreaks, startCoopStreak, endCoopStreak } from '../api/coopStreaks';
import { fetchDuels } from '../api/duels';
import { fetchInviteCodes, createInviteCode, deleteInviteCode } from '../api/inviteCodes';
import { fetchXpLeaderboard } from '../api/leaderboards';
import AvatarDisplay from '../components/AvatarDisplay';
import GloAvatar from '../components/GloAvatar';
import ConfirmDialog from '../components/ConfirmDialog';
import GoalChallengeDialog from '../components/GoalChallengeDialog';
import { useDocumentTitle } from '../utils/useDocumentTitle';
import { hasFeature } from '../utils/features';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Friends() {
  useDocumentTitle('Kompisar');
  const { user, apiFetch } = useAuth();
  const { profile } = useGamification();
  const [friends, setFriends] = useState([]);
  const [coopStreaks, setCoopStreaks] = useState([]);
  const [duels, setDuels] = useState([]);
  const [inviteCodes, setInviteCodes] = useState([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState(null);
  const [xpBoard, setXpBoard] = useState({ leaderboard: [], since: null });
  const [addInput, setAddInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingBlock, setPendingBlock] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [showGoalChallenge, setShowGoalChallenge] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [fs, coops, ds, invites, xp, bl] = await Promise.all([
        fetchFriends(apiFetch),
        fetchCoopStreaks(apiFetch),
        fetchDuels(apiFetch),
        fetchInviteCodes(apiFetch),
        fetchXpLeaderboard(apiFetch, 'month'),
        fetchBlocked(apiFetch)
      ]);
      setFriends(fs);
      setBlocked(bl);
      setCoopStreaks(coops);
      setDuels(ds);
      setInviteCodes(invites);
      setXpBoard(xp);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [apiFetch]);

  const onStartCoop = async (friendId) => {
    setError('');
    try {
      const coop = await startCoopStreak(apiFetch, friendId);
      // Lägg till om den är ny, ersätt om den fanns
      setCoopStreaks((cur) => {
        const filtered = cur.filter((c) => c._id !== coop._id);
        return [coop, ...filtered];
      });
    } catch (e) {
      setError(e.message);
    }
  };

  const onEndCoop = async (id) => {
    setError('');
    try {
      await endCoopStreak(apiFetch, id);
      setCoopStreaks((cur) => cur.filter((c) => c._id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const onCreateInvite = async () => {
    setError('');
    setInviteBusy(true);
    try {
      const invite = await createInviteCode(apiFetch);
      setInviteCodes((cur) => [invite, ...cur]);
    } catch (e) {
      setError(e.message);
    } finally {
      setInviteBusy(false);
    }
  };

  const onDeleteInvite = async (id) => {
    setError('');
    try {
      await deleteInviteCode(apiFetch, id);
      setInviteCodes((cur) => cur.filter((c) => c._id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const onCopyInvite = async (invite) => {
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopiedInviteId(invite._id);
      setTimeout(() => setCopiedInviteId((cur) => (cur === invite._id ? null : cur)), 1800);
    } catch {
      setError('Kunde inte kopiera. Markera koden manuellt.');
    }
  };

  const daysUntil = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'utgången';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days >= 1) return `${days} ${days === 1 ? 'dag' : 'dagar'} kvar`;
    const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
    return `${hours} ${hours === 1 ? 'timme' : 'timmar'} kvar`;
  };

  useEffect(() => { load(); }, [load]);

  const onAdd = async (e) => {
    e.preventDefault();
    const cleaned = addInput.trim().replace(/\s+/g, '').toUpperCase();
    if (!cleaned) return;
    setAddBusy(true);
    setError('');
    setNotice('');
    try {
      const friend = await addFriendByCode(apiFetch, cleaned);
      setNotice(`Klart — du och ${friend.username} är nu kompisar.`);
      setAddInput('');
      // Refresh list to capture the new entry (and dedupe if already added).
      setFriends(await fetchFriends(apiFetch));
    } catch (err) {
      setError(err.message);
    } finally {
      setAddBusy(false);
    }
  };

  const onRemoveConfirmed = async () => {
    if (!pendingRemove) return;
    const f = pendingRemove;
    setPendingRemove(null);
    try {
      await removeFriend(apiFetch, f._id);
      setFriends((cur) => cur.filter((x) => x._id !== f._id));
    } catch (err) {
      setError(err.message);
    }
  };

  const onBlockConfirmed = async () => {
    if (!pendingBlock) return;
    const f = pendingBlock;
    setPendingBlock(null);
    try {
      setBlocked(await blockUser(apiFetch, f._id));
      setFriends((cur) => cur.filter((x) => x._id !== f._id));
      setCoopStreaks((cur) => cur.filter((c) => c.other?._id !== f._id));
      setNotice(`${f.username} är blockerad.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const onUnblock = async (b) => {
    setError('');
    try {
      setBlocked(await unblockUser(apiFetch, b._id));
      setNotice(`Blockeringen av ${b.username} är hävd. Ni kan lägga till varandra igen med en kod.`);
    } catch (err) {
      setError(err.message);
    }
  };

  // Streak-race: mig + alla kompisar, sorterat på nuvarande streak. Topp-3
  // får medaljer. Krypterar inte ner till noll-streaks, men de syns på sin
  // plats i botten.
  const streakLeaderboard = useMemo(() => {
    const rows = [
      {
        _id: 'me',
        username: user?.username || 'du',
        avatar: profile?.avatar || { kind: 'initial', value: '' },
        current: profile?.streak?.current ?? 0,
        longest: profile?.streak?.longest ?? 0,
        isMe: true
      },
      ...friends.map((f) => ({
        _id: f._id,
        username: f.username,
        avatar: f.avatar,
        current: f.streak?.current ?? 0,
        longest: f.streak?.longest ?? 0,
        isMe: false
      }))
    ];
    rows.sort((a, b) => {
      if (b.current !== a.current) return b.current - a.current;
      return b.longest - a.longest; // tie-break på rekord
    });
    return rows;
  }, [user, profile, friends]);

  if (busy && friends.length === 0) {
    return <p className="t-hand muted">Glo letar upp dina kompisar…</p>;
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="t-hand muted" style={{ fontSize: 17 }}>Glo:s kompis-koder</div>
          <h1 style={{ fontSize: 40, margin: '4px 0 0' }}>
            Plugga <span className="mark-highlight">med kompisar</span>
          </h1>
        </div>
        <GloAvatar size={92} float tilt={-4} mood="wink" />
      </div>

      <div className="card card-lg" style={{ background: 'var(--sky-soft)' }}>
        <div className="row between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
          <div className="grow" style={{ minWidth: 200 }}>
            <h3 style={{ margin: 0 }}>🔒 Dina inbjudningskoder</h3>
            <p className="t-hand muted" style={{ fontSize: 15, margin: '4px 0 0' }}>
              Skapa en kod, skicka till en specifik kompis. Funkar i 7 dagar och bara en gång.
              {' '}<strong style={{ color: 'var(--coral-deep)' }}>När hen använder koden får ni båda 100 XP! 🎁</strong>
              {' '}Bjud in 3 kompisar → studentmössa till Glo. 10 kompisar → Ambassadör-badge.
            </p>
          </div>
          <button className="btn btn-primary" onClick={onCreateInvite} disabled={inviteBusy}>
            {inviteBusy ? 'Skapar…' : '+ Skapa ny kod'}
          </button>
        </div>
        {inviteCodes.length > 0 && (
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            {inviteCodes.map((i) => {
              const isCopied = copiedInviteId === i._id;
              return (
                <div
                  key={i._id}
                  className="row"
                  style={{
                    gap: 10,
                    padding: '8px 12px',
                    background: 'var(--bg-elev)',
                    border: '1.5px solid var(--ink)',
                    borderRadius: 10,
                    alignItems: 'center',
                    flexWrap: 'wrap'
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 800,
                      fontSize: 20,
                      letterSpacing: '0.12em'
                    }}
                  >
                    {i.code}
                  </span>
                  <span className="pill" style={{ background: 'var(--paper-edge)', fontSize: 12 }}>
                    {daysUntil(i.expiresAt)}
                  </span>
                  <span className="grow" />
                  <button className="btn btn-sm" onClick={() => onCopyInvite(i)}>
                    {isCopied ? 'Kopierad!' : 'Kopiera'}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--berry-deep)' }}
                    onClick={() => onDeleteInvite(i._id)}
                  >
                    Ta bort
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <form onSubmit={onAdd} className="card stack">
        <label className="field">
          <span className="field-label">Har du fått en kod av en kompis?</span>
          <input
            className="inp"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
            placeholder="t.ex. KQ7M2X9P"
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}
          />
        </label>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          {notice && <span className="t-hand" style={{ color: 'var(--leaf-deep)', fontSize: 15 }}>{notice}</span>}
          <button type="submit" className="btn btn-primary" disabled={addBusy || addInput.length !== 8}>
            {addBusy ? 'Glo söker…' : 'Lägg till kompis'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      <div>
        <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>⚔️ Utmaningar</h2>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => setShowGoalChallenge(true)}
              style={{ background: 'var(--mustard-soft)' }}
            >
              🎯 Klarar du den här?
            </button>
          </div>
        </div>
        {duels.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 24 }}>
            <p className="t-hand muted" style={{ margin: 0 }}>
              Inga utmaningar än. Skicka en till en kompis från en lista eller med "Klarar du den här?" ovan.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {duels.map((d) => {
              const myStatus = d.myStatus;
              const link =
                d.kind === 'live' && myStatus === 'pending'
                  ? `/duels/${d._id}/live`
                  : myStatus === 'pending'
                    ? `/duels/${d._id}/play`
                    : `/duels/${d._id}/result`;
              const others = d.participants.filter((p) => String(p.user) !== String(user?.id || user?._id));
              const completedCount = d.participants.filter((p) => p.status === 'completed').length;
              const titleText = d.kind === 'goal' ? (d.title || 'Klarar du den här?') : (d.list?.title || 'lista borttagen');
              const kindPill = d.kind === 'live' ? '⚡ live' : d.kind === 'goal' ? '🎯 mål' : null;
              return (
                <Link key={d._id} to={link} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div
                    className="card row"
                    style={{
                      padding: 14,
                      gap: 12,
                      alignItems: 'center',
                      background: myStatus === 'pending' ? 'var(--berry-soft)' : d.allCompleted ? 'var(--leaf-soft)' : 'var(--bg-elev)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex' }}>
                      {others.slice(0, 3).map((p, i) => (
                        <AvatarDisplay
                          key={p.user}
                          avatar={p.avatar}
                          username={p.username || '?'}
                          size={36}
                          style={{ marginLeft: i === 0 ? 0 : -10, border: '2px solid var(--bg-elev)' }}
                        />
                      ))}
                    </div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 16 }}>{titleText}</strong>
                        {kindPill && (
                          <span
                            className="pill"
                            style={{
                              background: d.kind === 'live' ? 'var(--coral-soft)' : 'var(--mustard-soft)',
                              fontSize: 12
                            }}
                          >
                            {kindPill}{d.kind === 'goal' && d.goal != null ? ` ${d.goal}` : ''}
                          </span>
                        )}
                      </div>
                      <p className="t-hand muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                        {myStatus === 'pending'
                          ? 'Klicka för att spela →'
                          : d.allCompleted
                            ? 'Alla klara — se resultatet'
                            : `Du klar · ${completedCount} av ${d.participants.length} har spelat`}
                      </p>
                    </div>
                    <span className="pill" style={{ background: 'var(--bg-elev)' }}>
                      {myStatus === 'pending' ? 'din tur' : d.allCompleted ? 'klar' : 'väntar'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {coopStreaks.length > 0 && (
        <div>
          <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Co-op-streaks</h2>
            <span className="t-hand muted" style={{ fontSize: 14 }}>kör båda samma dag → tickar upp</span>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {coopStreaks.map((c) => (
              <div
                key={c._id}
                className="card row"
                style={{
                  padding: 14,
                  gap: 12,
                  alignItems: 'center',
                  background: c.current > 0 ? 'var(--coral-soft)' : 'var(--paper-edge)'
                }}
              >
                <div className="row" style={{ gap: -6, alignItems: 'center' }}>
                  <AvatarDisplay
                    avatar={profile?.avatar}
                    username={user?.username || ''}
                    size={36}
                  />
                  <AvatarDisplay
                    avatar={c.other?.avatar}
                    username={c.other?.username || '?'}
                    size={36}
                    style={{ marginLeft: -10, border: '2px solid var(--bg-elev)' }}
                  />
                </div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 16 }}>
                    Du + {c.other?.username || 'okänd'}
                  </strong>
                  <p className="t-hand muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                    längsta hittills: {c.longest}
                    {c.lastBothActiveDay && ` · senast: ${new Date(c.lastBothActiveDay).toLocaleDateString('sv-SE')}`}
                  </p>
                </div>
                <span className="pill" style={{ background: 'var(--bg-elev)' }}>
                  <img src="/assets/flame-streak.svg" width="12" height="16" alt="" />
                  {c.current} {c.current === 1 ? 'dag' : 'dagar'}
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ color: 'var(--berry-deep)' }}
                  onClick={() => onEndCoop(c._id)}
                >
                  Avsluta
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {friends.length > 0 && xpBoard.leaderboard.some((r) => r.xp > 0) && (
        <div>
          <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              <img src="/assets/star-sticker.svg" width="22" height="22" alt="" style={{ verticalAlign: -3, marginRight: 6 }} />
              Månadens XP
            </h2>
            <span className="t-hand muted" style={{ fontSize: 14 }}>
              {xpBoard.since ? `sedan ${new Date(xpBoard.since).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })}` : ''}
            </span>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {xpBoard.leaderboard.map((row, i) => {
              const medal = i < 3 && row.xp > 0 ? MEDALS[i] : null;
              return (
                <div
                  key={row._id}
                  className="row"
                  style={{
                    gap: 12,
                    padding: '12px 16px',
                    background: row.isMe ? 'var(--paper-deep)' : 'var(--bg-elev)',
                    borderBottom: i < xpBoard.leaderboard.length - 1 ? '1px dashed var(--paper-edge)' : 'none'
                  }}
                >
                  <span style={{ width: 28, fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 18, textAlign: 'center' }}>
                    {medal || `#${i + 1}`}
                  </span>
                  <AvatarDisplay avatar={row.avatar} username={row.username} size={36} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 16 }}>{row.username}</strong>
                      {row.isMe && <span className="t-hand muted" style={{ fontSize: 13 }}>(du)</span>}
                    </div>
                  </div>
                  <span className="pill" style={{ background: row.xp > 0 ? 'var(--mustard-soft)' : 'var(--paper-edge)' }}>
                    <img src="/assets/star-sticker.svg" width="12" height="12" alt="" />
                    {row.xp} XP
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {friends.length > 0 && (
        <div>
          <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              <img src="/assets/flame-streak.svg" width="22" height="28" alt="" style={{ verticalAlign: -4, marginRight: 6 }} />
              Streak-race
            </h2>
            <span className="t-hand muted" style={{ fontSize: 14 }}>vem håller längst i rad?</span>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {streakLeaderboard.map((row, i) => {
              const medal = i < 3 && row.current > 0 ? MEDALS[i] : null;
              return (
                <div
                  key={row._id}
                  className="row"
                  style={{
                    gap: 12,
                    padding: '12px 16px',
                    background: row.isMe ? 'var(--paper-deep)' : 'var(--bg-elev)',
                    borderBottom: i < streakLeaderboard.length - 1 ? '1px dashed var(--paper-edge)' : 'none'
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 800,
                      fontSize: 18,
                      textAlign: 'center'
                    }}
                  >
                    {medal || `#${i + 1}`}
                  </span>
                  <AvatarDisplay avatar={row.avatar} username={row.username} size={36} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 16 }}>{row.username}</strong>
                      {row.isMe && (
                        <span className="t-hand muted" style={{ fontSize: 13 }}>(du)</span>
                      )}
                    </div>
                    <p className="t-hand muted" style={{ fontSize: 13, margin: '2px 0 0' }}>
                      längsta hittills: {row.longest}
                    </p>
                  </div>
                  <span
                    className="pill"
                    style={{ background: row.current > 0 ? 'var(--sky-soft)' : 'var(--paper-edge)' }}
                  >
                    <img src="/assets/flame-streak.svg" width="12" height="16" alt="" />
                    {row.current} {row.current === 1 ? 'dag' : 'dagar'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Dina kompisar</h2>
          <span className="t-hand muted" style={{ fontSize: 14 }}>
            {friends.length} {friends.length === 1 ? 'kompis' : 'kompisar'}
          </span>
        </div>
        {friends.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 32 }}>
            <p className="t-hand muted" style={{ fontSize: 16 }}>
              Inga kompisar än. Dela din kod ovan så händer det fort.
            </p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {friends.map((f) => {
              const hasCoop = coopStreaks.some((c) => c.other?._id === f._id);
              return (
                <div key={f._id} className="card row" style={{ padding: 14, gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <AvatarDisplay avatar={f.avatar} username={f.username} size={48} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: 20 }}>{f.username}</h3>
                    <p className="t-hand muted" style={{ fontSize: 14, margin: '2px 0 0' }}>
                      Kompisar sedan {new Date(f.addedAt).toLocaleDateString('sv-SE')}
                    </p>
                  </div>
                  {!hasCoop && (
                    <button
                      className="btn btn-sm"
                      onClick={() => onStartCoop(f._id)}
                      title="Starta gemensam streak — båda måste köra varje dag"
                    >
                      + co-op-streak
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--berry-deep)' }}
                    onClick={() => setPendingRemove(f)}
                  >
                    Ta bort
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--berry-deep)' }}
                    onClick={() => setPendingBlock(f)}
                    title="Sluta vara kompisar och stoppa allt från den här personen"
                  >
                    Blockera
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {blocked.length > 0 && (
        <details className="card">
          <summary style={{ fontWeight: 800, cursor: 'pointer' }}>🚫 Blockerade ({blocked.length})</summary>
          <p className="t-hand muted" style={{ fontSize: 14, margin: '8px 0 10px' }}>
            De kan inte lägga till dig, dela med dig eller gå med i det du delar via länk. De får inget besked om det.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {blocked.map((b) => (
              <div key={b._id} className="row" style={{ gap: 12, alignItems: 'center', padding: 8, border: '1.5px solid var(--ink)', borderRadius: 10 }}>
                <AvatarDisplay avatar={b.avatar} username={b.username} size={36} />
                <span className="grow" style={{ fontWeight: 700 }}>{b.username}</span>
                <button type="button" className="btn btn-sm" onClick={() => onUnblock(b)}>Häv blockering</button>
              </div>
            ))}
          </div>
        </details>
      )}

      {pendingBlock && (
        <ConfirmDialog
          title={`Blockera ${pendingBlock.username}?`}
          message={`Ni slutar vara kompisar, och listor ni delat med varandra tas bort, liksom pågående utmaningar och co-op-streak.${hasFeature(user, 'study') ? ' Kopior av Plugga-områden som redan getts bort är den andras och finns kvar.' : ''} ${pendingBlock.username} kan inte lägga till dig igen, dela med dig eller gå med i det du delar via länk, och får inget besked om att du blockerat. Du kan häva blockeringen här senare.`}
          confirmLabel="Blockera"
          destructive
          onConfirm={onBlockConfirmed}
          onCancel={() => setPendingBlock(null)}
        />
      )}

      {pendingRemove && (
        <ConfirmDialog
          title="Ta bort kompisen?"
          message={`${pendingRemove.username} tas bort från din kompislista, och du från ${pendingRemove.username}s.${hasFeature(user, 'study') ? ' Kopior av Plugga-områden ni gett varandra är era egna och finns kvar.' : ''} Ni kan alltid lägga till varandra igen.`}
          confirmLabel="Ta bort"
          destructive
          onConfirm={onRemoveConfirmed}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {showGoalChallenge && (
        <GoalChallengeDialog onClose={() => setShowGoalChallenge(false)} />
      )}
    </div>
  );
}
