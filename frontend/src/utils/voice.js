// Voice (TTS + STT) helpers — wraps the browser's Web Speech API.
// SpeechSynthesis is broadly supported. SpeechRecognition is Chromium-only
// in practice (Chrome, Edge, Opera) — Firefox + Safari don't have it.

const LANG_TO_BCP47 = {
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  en: 'en-US',
  sv: 'sv-SE'
};

export function bcp47(lang) {
  return LANG_TO_BCP47[lang] || lang;
}

export function isTTSSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function isSTTSupported() {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  );
}

// Cancel anything Glo was saying and read the given text in the given language.
export function speak(text, lang) {
  if (!isTTSSupported() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = bcp47(lang);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch (e) {
    // Ignore — TTS is non-critical.
    console.warn('TTS failed:', e);
  }
}

export function stopSpeaking() {
  if (!isTTSSupported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

// Build a SpeechRecognition for a single utterance in the given language.
// Returns null if the browser doesn't support it.
export function createRecognition(lang) {
  const SR =
    (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) ||
    null;
  if (!SR) return null;
  const recognition = new SR();
  recognition.lang = bcp47(lang);
  recognition.continuous = false;
  recognition.interimResults = false;
  // Ask for several alternatives so the consumer can match against homophones
  // like English "read" (past, spelled like "red" phonetically) vs "read" (inf.).
  recognition.maxAlternatives = 5;
  return recognition;
}
