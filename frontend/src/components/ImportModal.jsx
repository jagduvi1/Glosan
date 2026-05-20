import { useState } from 'react';
import { parseList } from '../api/ai';

export default function ImportModal({
  mode,
  defaultSourceLang = '',
  defaultTargetLang = '',
  apiFetch,
  onClose,
  onConfirm
}) {
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
          <h3 style={{ margin: 0 }}>
            {mode === 'new' ? 'Importera till ny lista' : 'Importera fler glosor'}
          </h3>
          <button onClick={onClose} disabled={busy}>Stäng</button>
        </div>

        <div className="modal-body stack">
          {error && <p className="error">{error}</p>}

          {step === 'input' && (
            <>
              {mode === 'new' && (
                <>
                  <label>Titel
                    <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Franska v20" />
                  </label>
                  <label>Beskrivning (valfri)
                    <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
                  </label>
                  <div className="row">
                    <label style={{ flex: 1 }}>Från (lämna tom = AI gissar)
                      <input value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} maxLength={10} placeholder="auto" />
                    </label>
                    <label style={{ flex: 1 }}>Till (lämna tom = AI gissar)
                      <input value={targetLang} onChange={(e) => setTargetLang(e.target.value)} maxLength={10} placeholder="auto" />
                    </label>
                  </div>
                </>
              )}
              <label>Klistra in glosorna (tabbar, mellanslag, streck — AI hanterar formatet)
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={12}
                  style={{ resize: 'vertical', minHeight: '220px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}
                  maxLength={8000}
                />
              </label>
              <p className="muted">{text.length} / 8000 tecken</p>
            </>
          )}

          {step === 'loading' && <p>AI tolkar texten…</p>}

          {step === 'review' && (
            <>
              <p className="muted">
                AI hittade {glosor.length} glosor ({sourceLang || '?'} → {targetLang || '?'}). Redigera eller ta bort innan du sparar.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>{sourceLang || 'Källa'}</th>
                    <th style={th}>{targetLang || 'Mål'}</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {glosor.map((g) => (
                    <tr key={g.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={td}><input value={g.source} onChange={(e) => updateGlos(g.id, 'source', e.target.value)} /></td>
                      <td style={td}><input value={g.target} onChange={(e) => updateGlos(g.id, 'target', e.target.value)} /></td>
                      <td style={{ ...td, width: '5rem' }}><button onClick={() => removeGlos(g.id)}>Ta bort</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {step === 'saving' && <p>Sparar {glosor.length} glosor…</p>}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>Avbryt</button>
          {step === 'input' && (
            <button className="primary" onClick={onParse}>Tolka med AI</button>
          )}
          {step === 'review' && (
            <button className="primary" onClick={onSave} disabled={glosor.length === 0}>
              Spara {glosor.length} glosor
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const th = { textAlign: 'left', padding: '0.5rem', fontSize: '0.85rem', color: 'var(--color-muted)' };
const td = { padding: '0.25rem' };
