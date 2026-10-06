import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { changeUsername } from '../api/me';

// Formuläret för att byta användarnamn — på profilsidan och i dialogen vid
// första Google-inloggningen. Reglerna kontrolleras på servern
// (services/username.js); här visas bara svaret.
export const USERNAME_HINT = '3–30 tecken: bokstäver, siffror, punkt, bindestreck eller understreck.';

export default function UsernameForm({ initial, submitLabel = 'Spara', onDone, onCancel, autoFocus = true }) {
  const { apiFetch, updateUser } = useAuth();
  const { refresh } = useGamification();
  const [name, setName] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await changeUsername(apiFetch, name);
      // Svaret har den nya användaren — ingen ny fråga som kan misslyckas.
      updateUser(user);
      refresh(); // profilen (topplistor m.m.) har också namnet
      setBusy(false);
      onDone?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="stack" style={{ gap: 8 }}>
      <label className="field" style={{ margin: 0 }}>
        <span className="field-label">Användarnamn</span>
        <input
          className="inp"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          required
        />
      </label>
      <p className="t-hand muted" style={{ fontSize: 14, margin: 0 }}>{USERNAME_HINT}</p>
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Sparar…' : submitLabel}
        </button>
        {onCancel && <button className="btn btn-sm btn-ghost" type="button" onClick={onCancel} disabled={busy}>Avbryt</button>}
      </div>
    </form>
  );
}
