import { useState } from 'react';
import { parseList } from '../api/ai';
import { useGamification } from '../contexts/GamificationContext';
import GloAvatar from './GloAvatar';

export default function ImportModal({
  mode,
  defaultSourceLang = '',
  defaultTargetLang = '',
  apiFetch,
  onClose,
  onConfirm
}) {
  const { refresh: refreshGamification } = useGamification();
  const [step, setStep] = useState('input');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceLang, setSourceLang] = useState(defaultSourceLang);
  const [targetLang, setTargetLang] = useState(defaultTargetLang);
  const [glosor, setGlosor] = useState([]);
  const [error, setError] = useState('');

  const onParse = async () => {
    setError('');
    if (!text.trim()) {
      setError('Klistra in text först.');
      return;
    }
    if (mode === 'new' && !title.trim()) {
      setError('Listan behöver en titel.');
      return;
    }
    setStep('loading');
    try {
      const payload = { text };
      if (sourceLang) payload.sourceLang = sourceLang;
      if (targetLang) payload.targetLang = targetLang;
      const result = await parseList(apiFetch, payload);
      if (mode === 'new') {
        if (result.sourceLang && !sourceLang) setSourceLang(result.sourceLang);
        if (result.targetLang && !targetLang) setTargetLang(result.targetLang);
      }
      setGlosor(result.glosor.map((g) => ({ ...g, id: crypto.randomUUID() })));
      setStep('review');
      refreshGamification();
    } catch (e) {
      setError(e.message);
      setStep('input');
    }
  };

  const updateGlos = (id, field, value) => {
    setGlosor((cur) => cur.map((g) => (g.id === id ? { ...g, [field]: value } : g)));
  };

  const removeGlos = (id) => {
    setGlosor((cur) => cur.filter((g) => g.id !== id));
  };

  const onSave = async () => {
    setError('');
    const cleaned = glosor
      .map((g) => ({ source: g.source.trim(), target: g.target.trim() }))
      .filter((g) => g.source && g.target);
    if (cleaned.length === 0) {
      setError('Inga giltiga glosor att spara.');
      return;
    }
    setStep('saving');
    try {
      await onConfirm({
        title: title.trim(),
        description: description.trim(),
        sourceLang: sourceLang || 'sv',
        targetLang: targetLang || 'en',
        glosor: cleaned
      });
    } catch (e) {
      setError(e.message);
      setStep('review');
    }
  };

  const busy = step === 'loading' || step === 'saving';

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div className="row" style={{ gap: 12 }}>
            <GloAvatar size={40} mood="wink" tilt={-6} />
            <h3 style={{ margin: 0 }}>
              {mode === 'new' ? 'Importera till ny lista' : 'Importera fler glosor'}
            </h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={busy}>×</button>
        </div>

        <div className="modal-body">
          {error && <p className="error" style={{ marginBottom: 14 }}>{error}</p>}

          {step === 'input' && (
            <div className="stack">
              {mode === 'new' && (
                <>
                  <label className="field">
                    <span className="field-label">Titel</span>
                    <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Franska v20" autoFocus />
                  </label>
                  <label className="field">
                    <span className="field-label">Beskrivning (valfri)</span>
                    <input className="inp" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
                  </label>
                  <div className="row" style={{ gap: 12 }}>
                    <label className="field" style={{ flex: 1 }}>
                      <span className="field-label">Från (lämna tomt för auto)</span>
                      <input className="inp" value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} maxLength={10} placeholder="auto" />
                    </label>
                    <label className="field" style={{ flex: 1 }}>
                      <span className="field-label">Till (lämna tomt för auto)</span>
                      <input className="inp" value={targetLang} onChange={(e) => setTargetLang(e.target.value)} maxLength={10} placeholder="auto" />
                    </label>
                  </div>
                </>
              )}
              <label className="field">
                <span className="field-label">Klistra in glosorna — Glo hanterar tabbar, mellanslag, streck</span>
                <textarea
                  className="inp"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={12}
                  style={{ minHeight: '220px', fontFamily: 'var(--font-mono)' }}
                  maxLength={8000}
                />
              </label>
              <p className="t-hand muted" style={{ fontSize: 13 }}>{text.length} / 8000 tecken</p>
            </div>
          )}

          {step === 'loading' && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <GloAvatar size={100} float />
              <p className="t-hand muted" style={{ fontSize: 17, marginTop: 12 }}>
                Glo läser texten…
              </p>
            </div>
          )}

          {step === 'review' && (
            <div className="stack">
              <p className="t-hand muted" style={{ fontSize: 15 }}>
                Glo hittade {glosor.length} glosor ({sourceLang || '?'} → {targetLang || '?'}). Justera om något blev fel.
              </p>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="glos-table">
                  <thead>
                    <tr>
                      <th>{sourceLang || 'källa'}</th>
                      <th>{targetLang || 'mål'}</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {glosor.map((g) => (
                      <tr key={g.id}>
                        <td><input className="inp" value={g.source} onChange={(e) => updateGlos(g.id, 'source', e.target.value)} style={{ boxShadow: 'none', padding: '8px 10px' }} /></td>
                        <td><input className="inp" value={g.target} onChange={(e) => updateGlos(g.id, 'target', e.target.value)} style={{ boxShadow: 'none', padding: '8px 10px' }} /></td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-sm btn-ghost"
                            style={{ color: 'var(--berry-deep)' }}
                            onClick={() => removeGlos(g.id)}
                            type="button"
                          >
                            Ta bort
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'saving' && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <GloAvatar size={100} float mood="wink" />
              <p className="t-hand muted" style={{ fontSize: 17, marginTop: 12 }}>
                Glo skriver in {glosor.length} glosor…
              </p>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>Avbryt</button>
          {step === 'input' && (
            <button className="btn btn-primary" onClick={onParse}>Tolka med Glo →</button>
          )}
          {step === 'review' && (
            <button className="btn btn-primary" onClick={onSave} disabled={glosor.length === 0}>
              Spara {glosor.length} glosor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
