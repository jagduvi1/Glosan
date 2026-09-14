const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');
const User = require('../models/User');
const { issueTokens } = require('../services/authTokens');
const { CookieStateStore } = require('../services/oauthStateStore');

const router = express.Router();

// Porterad från Cellarions routes/oauth.js (Google-delen; generiskt OIDC är
// medvetet bortstrippat). SSO är opt-in per deployment: strategin
// registreras, och routes fungerar, bara när båda Google-uppgifterna finns.
// En instans utan nycklar har klassisk användarnamn+lösenord-login orörd och
// frontendens knapp döljs (via /sso/providers-proben).
const GOOGLE_ENABLED = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const trimSlash = (s) => (s || '').replace(/\/$/, '');
// FRONTEND_URL kan vara kommaseparerad (flera domäner) — första posten är
// canonical, samma regel som email-länkarna i routes/auth.js.
const frontendBase = trimSlash((process.env.FRONTEND_URL || '').split(',')[0].trim()) || 'http://localhost:3000';

// Dit Google skickar tillbaka webbläsaren efter samtycke. Måste EXAKT matcha
// en "Authorized redirect URI" på Google-OAuth-klienten. API:t serveras
// under samma origin som SPA:n (nginx proxyar /api → backend), så URL:en
// härleds från FRONTEND_URL. Överstyr med GOOGLE_CALLBACK_URL när API:t nås
// på en annan host än FRONTEND_URL.
const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || `${frontendBase}/api/auth/google/callback`;

// SPA-landningen efter OAuth-rundresan. Vid success återställer SPA:n
// sessionen från refresh-cookien (AuthProvider kör /refresh vid mount); vid
// fel visas ett meddelande. Ingen token åker någonsin i URL:en.
const successRedirect = `${frontendBase}/login/callback`;
const failureRedirect = (reason) => `${frontendBase}/login/callback?error=${encodeURIComponent(reason)}`;

/**
 * Härled ett unikt, schema-giltigt användarnamn (3–30 tecken, [a-z0-9_.-],
 * gemener) ur emailens local-part eller visningsnamnet, med kort slumpsuffix
 * vid kollision så förstagångs-SSO-användare alltid får ett användbart handle.
 */
async function generateUniqueUsername(email, displayName) {
  const seed = email.split('@')[0] || displayName || 'user';
  let base = seed.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  if (base.length < 3) base = `${base}user`;
  base = base.slice(0, 24); // utrymme kvar för suffix inom 30-teckensgränsen

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${crypto.randomBytes(2).toString('hex')}`;
    const exists = await User.findOne({ username: candidate }).select('_id').lean();
    if (!exists) return candidate;
  }
  // Extremt osannolik fallback: base + längre slump, fortfarande inom 30 tecken.
  return `${base}-${crypto.randomBytes(4).toString('hex')}`.slice(0, 30);
}

/**
 * Gör om SSO-claims till ett Glosan-konto, i tre steg:
 *   1. redan länkad via (provider, providerId)      → returnera kontot
 *   2. befintligt konto med samma VERIFIERADE email → länka providern dit
 *   3. annars                                       → skapa nytt SSO-konto
 * Nedströms (roller, plans, refresh-rotation) beter sig kontot exakt som ett
 * lösenordskonto.
 *
 * Kravet på verifierad email är inte förhandlingsbart: vem som helst kan
 * hålla ett Google-konto, så en OVERIFIERAD adress är ett angriparkontrollerat
 * påstående — att länka på den vore att lämna över ett befintligt konto.
 */
async function upsertSsoUser(provider, claims) {
  const { providerId, displayName } = claims;
  const email = claims.email ? claims.email.toLowerCase() : null;
  const emailVerified = claims.emailVerified === true;

  // 1. Redan länkad?
  // $elemMatch, INTE två dotted-villkor: dotted paths in i en array av
  // subdokument matchas OBEROENDE av varandra — varje villkor kan uppfyllas
  // av OLIKA element — medan $elemMatch kräver att båda gäller inom samma
  // element, vilket är den faktiska frågan. (Cellarion hittade den buggen
  // skarpt; regressionen pinnas i oauth.test.js.)
  const linked = await User.findOne({ authProviders: { $elemMatch: { provider, providerId } } });
  if (linked) return linked;

  if (!email || !emailVerified) {
    const err = new Error('The identity provider did not supply a verified email address.');
    err.code = 'no_verified_email';
    throw err;
  }

  // 2. Befintligt konto med samma email → länka providern dit.
  const existing = await User.findOne({ email });
  if (existing) {
    existing.authProviders.push({ provider, providerId });
    if (!existing.emailVerified) {
      // Google har intygat adressen — samma bevisvärde som verify-mailet.
      existing.emailVerified = true;
      existing.emailVerifiedAt = new Date();
    }
    await existing.save();
    return existing;
  }

  // 3. Helt nytt SSO-konto.
  const username = await generateUniqueUsername(email, displayName);
  const user = new User({
    username,
    email,
    emailVerified: true, // provider-verifierad
    emailVerifiedAt: new Date(),
    roles: ['user'],
    // GDPR-grunden: texten under Google-knappen (Login/Register) är där
    // användaren bekräftar 13-årsgränsen/förälders tillåtelse — samma
    // innebörd som registreringsformulärets kryssruta.
    ageConsent: true,
    authProviders: [{ provider, providerId }]
  });
  await user.save();
  return user;
}

/**
 * Adapter: passport-google-oauth20-profil → neutrala claims. Google intygar
 * själv email-verifieringen (email_verified-claimet är auktoritativt).
 */
async function upsertGoogleUser(profile) {
  const emailEntry = Array.isArray(profile.emails) ? profile.emails[0] : null;
  return upsertSsoUser('google', {
    providerId: profile.id,
    email: emailEntry?.value || null,
    emailVerified: profile._json?.email_verified === true || emailEntry?.verified === true,
    displayName: profile.displayName
  });
}

const oauthStateStore = new CookieStateStore();

if (GOOGLE_ENABLED) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: CALLBACK_URL,
      // Bind rundresan till webbläsaren som startade den. Utan store använder
      // passport-oauth2 sin NullStore och callbacken byter in vilken
      // authorization-kod som helst — login-CSRF. Ingen session-middleware
      // finns här, så staten åker i en kortlivad httpOnly-cookie.
      store: oauthStateStore,
      // PKCE binder dessutom koden till flödets egen verifier, så en kod som
      // snappas upp i transit inte kan lösas in någon annanstans.
      pkce: 'S256'
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await upsertGoogleUser(profile);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));

  // Stateless: vi ger ut egen JWT + refresh-cookie, passport håller ingen
  // session — initialize() räcker.
  router.use(passport.initialize());
}

// GET /api/auth/sso/providers — publik. Låter login-sidan rendera
// Google-knappen bara när den faktiskt fungerar på den här instansen.
router.get('/sso/providers', (req, res) => {
  res.json({ google: GOOGLE_ENABLED });
});

// GET /api/auth/google — starta OAuth-redirecten till Google.
router.get('/google', (req, res, next) => {
  if (!GOOGLE_ENABLED) return res.redirect(failureRedirect('not_configured'));
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account'
  })(req, res, next);
});

// GET /api/auth/google/callback — Google skickar tillbaka hit efter samtycke.
// Custom callback så vi styr redirecten själva och aldrig läcker en token i
// URL:en: vid success sätts httpOnly-refresh-cookien och webbläsaren studsar
// till SPA:n, som hämtar sin access-token via /api/auth/refresh.
router.get('/google/callback', (req, res, next) => {
  if (!GOOGLE_ENABLED) return res.redirect(failureRedirect('not_configured'));
  passport.authenticate('google', { session: false }, async (err, user, info) => {
    if (err || !user) {
      // Google kan studsa tillbaka med ?error=... (oftast avbrutet samtycke)
      // och passport-oauth2 besvarar det INNAN state-storen konsulteras —
      // utgående cookien ligger då kvar i webbläsaren. Rensa här: ett
      // övergivet flöde ska inte lämna sin state efter sig.
      oauthStateStore.clear(res);
      // info bär state-storens utlåtande; utan den hade en misslyckad
      // browser-bindning sett ut som ett vanligt avbrutet samtycke.
      const reason = err?.code || info?.code || (err ? 'server_error' : 'access_denied');
      console.warn('[oauth] google sign-in failed', { reason });
      return res.redirect(failureRedirect(reason));
    }
    try {
      await issueTokens(user, res);
      return res.redirect(successRedirect);
    } catch (e) {
      console.error('OAuth token issue failed:', e);
      return res.redirect(failureRedirect('server_error'));
    }
  })(req, res, next);
});

module.exports = router;
// Exporteras för enhetstesterna (kontolänkningslogiken är den viktiga delen).
module.exports.upsertSsoUser = upsertSsoUser;
module.exports.upsertGoogleUser = upsertGoogleUser;
module.exports.generateUniqueUsername = generateUniqueUsername;
