import { useRef, useState } from 'react';
import { parseList, parseImage } from '../api/ai';
import { downscaleImage } from '../utils/image';
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
  // 'text' = klistra in, 'image' = fota/välj bild. Efter tolkningen är
  // flödet identiskt — samma granskningstabell, samma sparsteg.
  const [source, setSource] = useState('text');
  const [image, setImage] = useState(null); // { base64, mediaType, bytes }
  const [imagePreview, setImagePreview] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceLang, setSourceLang] = useState(defaultSourceLang);
  const [targetLang, setTargetLang] = useState(defaultTargetLang);
  const [glosor, setGlosor] = useState([]);
  const [error, setError] = useState('');

  const onParse = async () => {
    setError('');
    if (source === 'text' && !text.trim()) {
      setError('Klistra in text först.');
      return;
    }
    if (source === 'image' && !image) {
      setError('Välj eller ta en bild först.');
      return;
    }
    if (mode === 'new' && !title.trim()) {
      setError('Listan behöver en titel.');
      return;
    }
    setStep('loading');
    try {
      const payload = source === 'image'
        ? { image: image.base64, mediaType: image.mediaType }
        : { text };
      if (sourceLang) payload.sourceLang = sourceLang;
      if (targetLang) payload.targetLang = targetLang;
      const result = source === 'image'
        ? await parseImage(apiFetch, payload)
        : await parseList(apiFetch, payload);
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

  // Bilden skalas ner direkt vid valet, inte vid skickandet: då ser
  // användaren förhandsvisningen av exakt det som skickas, och väntan
  // ligger före knapptrycket i stället för efter.
  const onPickImage = async (file) => {
    if (!file) return;
    setError('');
    setImageBusy(true);
    try {
      const scaled = await downscaleImage(file);
      setImage(scaled);
      setImagePreview(`data:${scaled.mediaType};base64,${scaled.base64}`);
    } catch (e) {
      setImage(null);
      setImagePreview('');
      setError(e.message);
    } finally {
      setImageBusy(false);
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
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm${source === 'text' ? ' btn-primary' : ''}`}
                  onClick={() => { setSource('text'); setError(''); }}
                >
                  Klistra in text
                </button>
                <button
                  type="button"
                  className={`btn btn-sm${source === 'image' ? ' btn-primary' : ''}`}
                  onClick={() => { setSource('image'); setError(''); }}
                >
                  Ta bild
                </button>
              </div>

              {source === 'text' ? (
                <>
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
                </>
              ) : (
                <div className="stack">
                  {/* capture="environment" öppnar kameran direkt på mobilen;
                      på datorn blir exakt samma kontroll en filväljare. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      onPickImage(e.target.files?.[0]);
                      // Nollställ så att samma fil kan väljas igen.
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-lg btn-block"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={imageBusy}
                  >
                    {imageBusy ? 'Förbereder bilden…' : image ? 'Välj en annan bild' : 'Ta kort eller välj bild'}
                  </button>
                  {imagePreview && (
                    <img
                      src={imagePreview}
                      alt="Vald bild"
                      style={{ width: '100%', borderRadius: 12, border: '2px solid var(--ink)' }}
                    />
                  )}
                  <p className="t-hand muted" style={{ fontSize: 13 }}>
                    Fota glosbladet rakt ovanifrån i bra ljus — då blir tolkningen bäst.
                    Du får granska allt innan något sparas.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 'loading' && (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <GloAvatar size={100} float />
              <p className="t-hand muted" style={{ fontSize: 17, marginTop: 12 }}>
                {source === 'image' ? 'Glo tittar på bilden…' : 'Glo läser texten…'}
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
