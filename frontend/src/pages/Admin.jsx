import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchAdminUsers,
  fetchAdminPlans,
  setUserPlan,
  grantTrial,
  clearTrial,
  resetUsage
} from '../api/admin';
import AvatarDisplay from '../components/AvatarDisplay';
import GloAvatar from '../components/GloAvatar';
import { useDocumentTitle } from '../utils/useDocumentTitle';

function formatLimit(limit) {
  return limit === null ? 'obegränsat' : `${limit} / mån`;
}

function planPillStyle(planId, plans) {
  const p = plans.find((x) => x.id === planId);
  const color = p?.color || 'paper-deep';
  return { background: `var(--${color}-soft, var(--paper-edge))` };
}

function daysLeft(until) {
  if (!until) return 0;
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function Admin() {
  useDocumentTitle('Admin');
  const { apiFetch, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [actionError, setActionError] = useState('');
  const [trialForm, setTrialForm] = useState({ userId: null, plan: 'premium', days: 7 });

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [u, p] = await Promise.all([
        fetchAdminUsers(apiFetch),
        fetchAdminPlans(apiFetch)
      ]);
      setUsers(u);
      setPlans(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const filteredUsers = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return users;
    return users.filter((u) =>
      u.username?.toLowerCase().includes(f) ||
      u.email?.toLowerCase().includes(f)
    );
  }, [users, filter]);

  const replaceUser = (updated) => {
    setUsers((cur) => cur.map((u) => (u._id === updated._id ? updated : u)));
  };

  const onChangePlan = async (u, plan) => {
    if (plan === u.plan) return;
    setActionError('');
    try {
      const updated = await setUserPlan(apiFetch, u._id, plan);
      replaceUser(updated);
    } catch (e) {
      setActionError(e.message);
    }
  };

  const onGrantTrial = async (e) => {
    e.preventDefault();
    if (!trialForm.userId) return;
    setActionError('');
    try {
      const updated = await grantTrial(apiFetch, trialForm.userId, trialForm.plan, trialForm.days);
      replaceUser(updated);
      setTrialForm({ userId: null, plan: 'premium', days: 7 });
    } catch (e) {
      setActionError(e.message);
    }
  };

  const onClearTrial = async (u) => {
    setActionError('');
    try {
      const updated = await clearTrial(apiFetch, u._id);
      replaceUser(updated);
    } catch (e) {
      setActionError(e.message);
    }
  };

  const onResetUsage = async (u) => {
    setActionError('');
    try {
      const updated = await resetUsage(apiFetch, u._id);
      replaceUser(updated);
    } catch (e) {
      setActionError(e.message);
    }
  };

  if (busy && users.length === 0) {
    return <p className="t-hand muted">Glo hämtar listan över användare…</p>;
  }
  if (error) {
    return (
      <div className="card card-lg" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <GloAvatar size={120} float mood="sad" style={{ margin: '0 auto 12px' }} />
        <h2>Admin-sidan kan inte laddas</h2>
        <p className="muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="t-hand muted" style={{ fontSize: 17 }}>admin · {user?.username}</div>
          <h1 style={{ fontSize: 40, margin: '4px 0 0' }}>
            <span className="mark-highlight">Användare</span> & planer
          </h1>
        </div>
        <GloAvatar size={92} float tilt={-4} mood="default" />
      </div>

      <div className="card" style={{ background: 'var(--paper-edge)' }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {plans.map((p) => (
            <div key={p.id} className="pill" style={{ background: `var(--${p.color}-soft, var(--paper-edge))` }}>
              <strong>{p.label}</strong> · {formatLimit(p.aiCallsPerMonth)}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <label className="field">
          <span className="field-label">Sök användare</span>
          <input
            className="inp"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="användarnamn eller e-post"
            autoComplete="off"
          />
        </label>
      </div>

      {actionError && <p className="error">{actionError}</p>}

      <div className="stack" style={{ gap: 12 }}>
        {filteredUsers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 24 }}>
            <p className="t-hand muted">Inga användare matchar sökningen.</p>
          </div>
        ) : filteredUsers.map((u) => {
          const trialActive = u.trial?.active;
          const trialDays = daysLeft(u.trial?.until);
          const limit = u.aiUsage.limit;
          const used = u.aiUsage.used;
          const usagePct = limit === null
            ? 0
            : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
          const isAdmin = u.roles?.includes('admin');
          const isMe = u._id === user?.id;
          const openTrial = trialForm.userId === u._id;
          return (
            <div key={u._id} className="card" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <AvatarDisplay
                  avatar={{ kind: 'initial', value: '' }}
                  username={u.username}
                  size={48}
                />
                <div className="grow" style={{ minWidth: 220 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 20 }}>{u.username}</h3>
                    {isAdmin && <span className="pill" style={{ background: 'var(--coral-soft)', fontSize: 12 }}>admin</span>}
                    {isMe && <span className="t-hand muted" style={{ fontSize: 13 }}>(du)</span>}
                  </div>
                  <p className="t-hand muted" style={{ fontSize: 14, margin: '2px 0 0' }}>{u.email}</p>
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="pill" style={planPillStyle(u.effectivePlan, plans)}>
                    just nu: <strong>{plans.find((p) => p.id === u.effectivePlan)?.label || u.effectivePlan}</strong>
                  </span>
                  {trialActive && (
                    <span className="pill" style={{ background: 'var(--mustard-soft)' }}>
                      trial · {trialDays} {trialDays === 1 ? 'dag' : 'dagar'} kvar
                    </span>
                  )}
                </div>
              </div>

              <div className="row" style={{ gap: 16, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <label className="field" style={{ minWidth: 180 }}>
                  <span className="field-label">Bas-plan</span>
                  <select
                    className="inp"
                    value={u.plan}
                    onChange={(e) => onChangePlan(u, e.target.value)}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.label} · {formatLimit(p.aiCallsPerMonth)}</option>
                    ))}
                  </select>
                </label>
                <div className="grow" style={{ minWidth: 200 }}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <span className="t-hand muted" style={{ fontSize: 13 }}>AI-anrop ({u.aiUsage.monthKey})</span>
                    <span className="t-hand muted" style={{ fontSize: 13 }}>
                      {used} / {limit === null ? '∞' : limit}
                    </span>
                  </div>
                  <div className="bar-shell">
                    <div className="bar-fill bar-fill-coral" style={{ width: `${usagePct}%` }} />
                  </div>
                </div>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {!openTrial ? (
                  <button
                    className="btn btn-sm"
                    onClick={() => setTrialForm({ userId: u._id, plan: 'premium', days: 7 })}
                  >
                    {trialActive ? 'Förnya trial' : 'Ge trial'}
                  </button>
                ) : (
                  <form onSubmit={onGrantTrial} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      className="inp"
                      value={trialForm.plan}
                      onChange={(e) => setTrialForm((f) => ({ ...f, plan: e.target.value }))}
                      style={{ width: 'auto' }}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="inp"
                      min={1}
                      max={365}
                      value={trialForm.days}
                      onChange={(e) => setTrialForm((f) => ({ ...f, days: Number(e.target.value) || 1 }))}
                      style={{ width: 80 }}
                      aria-label="dagar"
                    />
                    <span className="t-hand muted" style={{ fontSize: 13 }}>dagar</span>
                    <button type="submit" className="btn btn-sm btn-primary">Ge</button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setTrialForm({ userId: null, plan: 'premium', days: 7 })}
                    >
                      Avbryt
                    </button>
                  </form>
                )}
                {trialActive && !openTrial && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => onClearTrial(u)}
                    style={{ color: 'var(--berry-deep)' }}
                  >
                    Avsluta trial
                  </button>
                )}
                {!openTrial && (
                  <button className="btn btn-sm btn-ghost" onClick={() => onResetUsage(u)}>
                    Nollställ AI-anrop
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
