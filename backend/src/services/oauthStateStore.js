const crypto = require('crypto');
const { COOKIE_SECURE } = require('./authTokens');

/**
 * Per-flöde OAuth-state (och PKCE-code-verifier) i en kortlivad httpOnly-
 * cookie, enligt passport-oauth2:s state-store-interface. Porterad från
 * Cellarions services/oauthStateStore.js.
 *
 * VARFÖR EN EGEN STORE I STÄLLET FÖR DE INBYGGDA: passport-oauth2:s
 * medskickade stores är session-baserade, och den här backenden kör ingen
 * session-middleware alls — den ger ut egen JWT + refresh-cookie och anropar
 * passport med { session: false }. Utan `store`/`state` faller passport
 * tillbaka på sin NullStore som inte verifierar någonting: callbacken byter
 * då in VILKEN authorization-kod som helst, dvs. flödet är inte bundet till
 * webbläsaren som startade det (login-CSRF: en angripare kan logga in offret
 * på ANGRIPARENS Google-konto). Cookien återställer bindningen utan att
 * införa server-side sessioner.
 *
 * sameSite:'lax' är ett KRAV, inte en preferens: callbacken kommer som en
 * top-level GET-navigering från Google — cross-site — vilket 'lax' släpper
 * igenom och 'strict' droppar. Med 'strict' hade varje inloggning fallerat i
 * verifieringen.
 *
 * Vad den försvarar: att callbacken hör ihop med webbläsaren som startade
 * flödet. Vad den INTE försvarar: en angripare som redan kan skriva cookies
 * för vår origin — därför är värdet en enkel slump snarare än en HMAC
 * (signering hade inte köpt något mot den angriparen).
 */

const DEFAULT_COOKIE_NAME = 'oauthState';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // hinner med consent-skärmen, låter en övergiven dö

// Path-scopad: enda endpoint som någonsin läser den är
// /api/auth/google/callback, så den har inget på övriga API-anrop att göra.
const COOKIE_PATH = '/api/auth';

const encode = (buf) => buf.toString('base64url');

/** Konstant-tid-jämförelse som tål olika längder. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

class CookieStateStore {
  constructor({ cookieName = DEFAULT_COOKIE_NAME, ttlMs = DEFAULT_TTL_MS, secure = COOKIE_SECURE } = {}) {
    this.cookieName = cookieName;
    this.ttlMs = ttlMs;
    this.cookieBase = {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: COOKIE_PATH
    };
  }

  /**
   * Anropas på vägen UT, före redirecten till Google. Fem-args-ariteten är
   * den PKCE-medvetna: passport-oauth2 genererar `verifier` när strategin
   * sätter `pkce` och lämnar den hit för förvaring. Returnerar state-värdet
   * som läggs på authorization-requesten.
   */
  store(req, verifier, state, meta, callback) {
    let value;
    try {
      value = encode(crypto.randomBytes(32));
      // state . issuedAt . verifier — verifier-delen är tom när PKCE är av.
      const payload = [value, Date.now(), verifier || ''].join('.');
      req.res.cookie(this.cookieName, payload, { ...this.cookieBase, maxAge: this.ttlMs });
    } catch (err) {
      return callback(err);
    }
    return callback(null, value);
  }

  /**
   * Anropas på vägen TILLBAKA, innan koden byts mot tokens. Cookien
   * konsumeras oavsett utfall — en kvarlämnad cookie efter ett misslyckat
   * försök hade låtit ett gammalt flöde fullbordas senare. OBS: passport-
   * oauth2 besvarar ett provider-fel (?error=access_denied) INNAN den når
   * hit, så routes/oauth.js rensar cookien på sin felväg också.
   *
   * Att verifier returneras som `ok`-värde är passport-oauth2:s sätt att
   * plocka upp code_verifier till token-requesten (sträng = PKCE på;
   * `true` är success utan PKCE).
   */
  verify(req, state, callback) {
    const raw = req.cookies ? req.cookies[this.cookieName] : undefined;
    this.clear(req.res);

    if (!raw || !state) return callback(null, false, { code: 'invalid_state' });

    const [expected, issuedAt, verifier] = String(raw).split('.');
    if (!expected || !safeEqual(expected, state)) {
      return callback(null, false, { code: 'invalid_state' });
    }

    // Hängslen utöver cookiens egen maxAge: en webbläsare som behållit den
    // längre (eller ett handreplayat värde) nekas ändå. Kollen kan bara
    // avvisa, aldrig godkänna fel state, så den behöver inget integritetsskydd.
    const age = Date.now() - Number(issuedAt);
    if (!Number.isFinite(age) || age < 0 || age > this.ttlMs) {
      return callback(null, false, { code: 'invalid_state' });
    }

    return callback(null, verifier || true);
  }

  /** Ta bort cookien. Säkert att anropa även när ingen är satt. */
  clear(res) {
    if (res && typeof res.clearCookie === 'function') {
      // Ingen maxAge här: med maxAge räknar Express fram ett FRAMTIDA expiry
      // och lämnar en tom cookie kvar i stället för att ta bort den.
      res.clearCookie(this.cookieName, this.cookieBase);
    }
  }
}

module.exports = { CookieStateStore, DEFAULT_COOKIE_NAME, DEFAULT_TTL_MS };
