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

  // Kameran öppnas direkt när man väljer bild-läget — målgruppen är barn
  // som aldrig laddar upp filer, och ett extra knapptryck på vägen dit är
  // ett steg för mycket. capture="environment" gör att mobilen går rakt
  // till kameran i stället för filväljaren.
  const openCamera = () => fileInputRef.current?.click();

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

  // Tar bort rättningsmarkeringen för ett fält. Används både när
  // användaren ångrar en rättning och när hen skriver om ordet själv —
  // i båda fallen är 'rättat från X' inte längre en sann beskrivning.
  const dropCorrection = (glos, field) => {
    if (!glos.corrections?.[field]) return glos.corrections;
    const rest = { ...glos.corrections };
    delete rest[field];
    return Object.keys(rest).length > 0 ? rest : undefined;
  };

  const updateGlos = (id, field, value) => {
    setGlosor((cur) => cur.map((g) => (
      g.id === id ? { ...g, [field]: value, corrections: dropCorrection(g, field) } : g
    )));
  };

  // Återställ ordet så som det faktiskt stod i underlaget.
  const revertCorrection = (id, field) => {
    setGlosor((cur) => cur.map((g) => (
      g.id === id && g.corrections?.[field]
        ? { ...g, [field]: g.corrections[field], corrections: dropCorrection(g, field) }
        : g
    )));
  };

  const removeGlos = (id) => {
    setGlosor((cur) => cur.filter((g) => g.id !== id));
  };

  // Rättade ord MARKERAS i stället för att bytas tyst. En felläsning som
  // AI:n snyggat till ett trovärdigt ord går annars inte att upptäcka i
  // granskningen — och det är precis den sortens fel som gör mest skada,
  // eftersom den ser rätt ut.
  const renderCell = (g, field) => (
    <>
      <input
        className="inp"
        value={g[field]}
        onChange={(e) => updateGlos(g.id, field, e.target.value)}
        style={{ boxShadow: 'none', padding: '8px 10px' }}
      />
      {g.corrections?.[field] && (
        <div className="t-hand muted" style={{ fontSize: 12, marginTop: 4 }}>
          rättat från ”{g.corrections[field]}”{' '}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ padding: '0 6px', fontSize: 12 }}
            onClick={() => revertCorrection(g.id, field)}
          >
            ångra
          </button>
        </div>
      )}
    </>
  );

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
  const correctedCount = glosor.filter((g) => g.corrections && Object.keys(g.corrections).length > 0).length;

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
              {/* Alltid monterad, även i text-läget: knappen nedan öppnar
                  kameran i samma klick som den byter läge, och då måste
                  input:en redan finnas i DOM:en — en ref till något som
                  renderas först efter state-uppdateringen är null just när
                  vi behöver den. Klicket måste dessutom ske i samma
                  användargest, annars blockerar webbläsaren filväljaren. */}
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
                  onClick={() => { setSource('image'); setError(''); openCamera(); }}
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
                  {imagePreview ? (
                    <>
                      <img
                        src={imagePreview}
                        alt="Bilden du tog"
                        style={{ width: '100%', borderRadius: 12, border: '2px solid var(--ink)' }}
                      />
                      <button
                        type="button"
                        className="btn btn-block"
                        onClick={openCamera}
                        disabled={imageBusy}
                      >
                        {imageBusy ? 'Förbereder bilden…' : 'Ta om'}
                      </button>
                    </>
                  ) : (
                    // Syns bara om kameran stängdes utan att något togs —
                    // annars har man redan en bild när man kommer hit.
                    <button
                      type="button"
                      className="btn btn-lg btn-block"
                      onClick={openCamera}
                      disabled={imageBusy}
                    >
                      {imageBusy ? 'Förbereder bilden…' : 'Öppna kameran'}
                    </button>
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
              {correctedCount > 0 && (
                <p className="t-hand" style={{ fontSize: 14, margin: 0 }}>
                  Glo rättade stavningen på {correctedCount} {correctedCount === 1 ? 'glosa' : 'glosor'} —
                  de är markerade nedan, och du kan ångra varje enskild.
                </p>
              )}
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
                        <td>{renderCell(g, 'source')}</td>
                        <td>{renderCell(g, 'target')}</td>
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
