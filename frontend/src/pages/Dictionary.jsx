import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { translate, exampleSentence } from '../api/ai';
import GloAvatar from '../components/GloAvatar';
import Flag from '../components/Flag';
import { LANG_TO_FLAG, LANG_NAMES } from '../utils/lang';
import { useDocumentTitle } from '../utils/useDocumentTitle';

const LANGS = ['sv', 'en', 'fr', 'de', 'es'];
const LAST_PAIR_KEY = 'glosan:dictPair';

function readPair() {
  try {
    const v = localStorage.getItem(LAST_PAIR_KEY);
    if (v) {
      const parsed = JSON.parse(v);
      if (parsed && LANGS.includes(parsed.source) && LANGS.includes(parsed.target)) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return { source: 'sv', target: 'fr' };
}

export default function Dictionary() {
  useDocumentTitle('Ordbok');
  const { apiFetch } = useAuth();
  const { refresh: refreshGamification } = useGamification();
  const [pair, setPair] = useState(readPair);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [example, setExample] = useState('');
  const [exampleBusy, setExampleBusy] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(LAST_PAIR_KEY, JSON.stringify(pair)); } catch { /* ignore */ }
  }, [pair]);

  const setSource = (source) => setPair({ ...pair, source });
  const setTarget = (target) => setPair({ ...pair, target });

  const onSwap = () => {
    setPair({ source: pair.target, target: pair.source });
    if (result) {
      setWord(result.translation);
      setResult(null);
      setExample('');
    }
  };

  const onLookup = async (e) => {
    e.preventDefault();
    if (!word.trim() || pair.source === pair.target) return;
    setBusy(true);
    setError('');
    setResult(null);
    setExample('');
    try {
      const translation = await translate(apiFetch, {
        word: word.trim(),
        sourceLang: pair.source,
        targetLang: pair.target
      });
      setResult({ word: word.trim(), translation, source: pair.source, target: pair.target });
      refreshGamification();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onGetExample = async () => {
    if (!result) return;
    setExampleBusy(true);
    setError('');
    try {
      const sentence = await exampleSentence(apiFetch, {
        word: result.translation,
        lang: result.target
      });
      setExample(sentence);
      refreshGamification();
    } catch (err) {
      setError(err.message);
    } finally {
      setExampleBusy(false);
    }
  };

  const sameLang = pair.source === pair.target;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="t-hand muted" style={{ fontSize: 17 }}>Glo:s ordbok</div>
          <h1 style={{ margin: '4px 0 0' }}>Slå upp <span className="mark-highlight">en glosa</span></h1>
        </div>
        <GloAvatar size={92} float tilt={-4} mood="wink" />
      </div>

      <form onSubmit={onLookup} className="card card-lg stack">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span className="field-label">Från</span>
            <select className="inp" value={pair.source} onChange={(e) => setSource(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>{LANG_NAMES[l] || l}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={onSwap}
            aria-label="Byt riktning"
            title="Byt riktning"
            style={{ height: 50, padding: '0 16px', fontSize: 20 }}
          >
            ↔
          </button>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span className="field-label">Till</span>
            <select className="inp" value={pair.target} onChange={(e) => setTarget(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>{LANG_NAMES[l] || l}</option>
              ))}
            </select>
          </label>
        </div>

        {sameLang && (
          <p className="t-hand muted" style={{ fontSize: 14 }}>
            Glo behöver två olika språk för att kunna översätta.
          </p>
        )}

        <label className="field">
          <span className="field-label">Ord eller fras</span>
          <input
            className="inp inp-lg"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={`skriv på ${LANG_NAMES[pair.source] || pair.source}…`}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
          />
        </label>

        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="t-hand muted" style={{ fontSize: 14 }}>
            tryck <code>enter</code> för att slå upp
          </span>
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !word.trim() || sameLang}>
            {busy ? 'Glo letar…' : 'Slå upp →'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="card card-lg pop-in" style={{ background: 'var(--leaf-soft)' }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 220 }}>
              <div className="t-hand muted" style={{ fontSize: 15 }}>
                {LANG_NAMES[result.source] || result.source} → {LANG_NAMES[result.target] || result.target}
              </div>
              <div className="row" style={{ gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                {LANG_TO_FLAG[result.source] && <Flag code={LANG_TO_FLAG[result.source]} />}
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, lineHeight: 1 }}>{result.word}</span>
              </div>
              <div className="row" style={{ gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                {LANG_TO_FLAG[result.target] && <Flag code={LANG_TO_FLAG[result.target]} />}
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, lineHeight: 1, color: 'var(--leaf-deep)' }}>
                  {result.translation}
                </span>
              </div>
              {example && (
                <p className="t-hand" style={{ marginTop: 16, fontSize: 16, lineHeight: 1.5 }}>
                  ↳ {example}
                </p>
              )}
            </div>
            {!example && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onGetExample}
                disabled={exampleBusy}
                style={{ background: 'var(--bg-elev)' }}
              >
                {exampleBusy ? 'Glo skriver…' : 'Be om mening'}
              </button>
            )}
          </div>
        </div>
      )}

      {!result && !busy && (
        <p className="t-hand muted" style={{ fontSize: 15, textAlign: 'center' }}>
          Slå upp ord från svenska, engelska, franska, tyska eller spanska — i valfri riktning.
        </p>
      )}
    </div>
  );
}
