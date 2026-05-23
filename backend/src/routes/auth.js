const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Token = require('../models/Token');
const emailService = require('../services/email');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many attempts, please try again later' })
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many refresh attempts, please try again later' })
});

// Striktare limit för endpoints som triggar email-skickning så ingen
// kan spamma våra Resend-kostnader genom att hamra knappen.
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Vänta en stund innan du begär ett nytt mail.' })
});

// Email-token-helpers: råa token-strängen visas bara i email-länken,
// DB-en innehåller endast SHA-256-hash så en kompromiss av Token-
// collection inte räcker för att verifiera någons email.
const EMAIL_TOKEN_BYTES = 32;
const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000;    // 60 min — säkerhetskänsligare
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;        // 15 min — kort eftersom det är login

function hashEmailToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createEmailToken({ user, kind, ttlMs }) {
  const raw = crypto.randomBytes(EMAIL_TOKEN_BYTES).toString('hex');
  await Token.create({
    user: user._id,
    kind,
    tokenHash: hashEmailToken(raw),
    expiresAt: new Date(Date.now() + ttlMs)
  });
  return raw;
}

async function consumeEmailToken({ token, kind }) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashEmailToken(token);
  const doc = await Token.findOne({ tokenHash, kind, usedAt: null });
  if (!doc || doc.expiresAt < new Date()) return null;
  doc.usedAt = new Date();
  await doc.save();
  return doc;
}

// Använd första FRONTEND_URL (om kommaseparerad) som canonical länk i
// email-mallar.
function canonicalFrontendUrl() {
  const raw = process.env.FRONTEND_URL || 'https://glosan.app';
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

async function sendVerifyEmail(user) {
  if (!emailService.isEnabled()) return false;
  const raw = await createEmailToken({ user, kind: 'verify-email', ttlMs: VERIFY_EMAIL_TTL_MS });
  const url = `${canonicalFrontendUrl()}/verify-email?token=${raw}`;
  await emailService.send({
    to: user.email,
    subject: 'Bekräfta din email — Glosan',
    html: emailService.wrapTemplate({
      title: 'Välkommen till Glosan!',
      intro: `Klicka på knappen nedan för att bekräfta att ${user.email} tillhör dig. Länken är giltig i 24 timmar.`,
      ctaUrl: url,
      ctaLabel: 'Bekräfta min email'
    }),
    text: `Välkommen till Glosan!\n\nBekräfta din email genom att klicka på länken nedan (giltig i 24h):\n${url}\n\nGlosan · ${canonicalFrontendUrl()}`
  });
  return true;
}

async function sendResetPasswordEmail(user) {
  if (!emailService.isEnabled()) return false;
  const raw = await createEmailToken({ user, kind: 'reset-password', ttlMs: RESET_PASSWORD_TTL_MS });
  const url = `${canonicalFrontendUrl()}/reset-password?token=${raw}`;
  await emailService.send({
    to: user.email,
    subject: 'Återställ ditt lösenord — Glosan',
    html: emailService.wrapTemplate({
      title: 'Återställ ditt lösenord',
      intro: `Klicka på knappen nedan för att välja ett nytt lösenord. Länken är giltig i 60 minuter. Var det inte du som begärde detta? Ignorera mailet — ditt nuvarande lösenord fungerar fortfarande.`,
      ctaUrl: url,
      ctaLabel: 'Välj nytt lösenord'
    }),
    text: `Återställ ditt lösenord på Glosan.\n\nKlicka på länken nedan (giltig i 60 min):\n${url}\n\nVar det inte du? Ignorera mailet.\n\nGlosan · ${canonicalFrontendUrl()}`
  });
  return true;
}

async function sendMagicLinkEmail(user) {
  if (!emailService.isEnabled()) return false;
  const raw = await createEmailToken({ user, kind: 'magic-link', ttlMs: MAGIC_LINK_TTL_MS });
  const url = `${canonicalFrontendUrl()}/magic-link?token=${raw}`;
  await emailService.send({
    to: user.email,
    subject: 'Din inloggningslänk till Glosan',
    html: emailService.wrapTemplate({
      title: 'Logga in på Glosan',
      intro: `Klicka på knappen nedan så loggas du in direkt. Länken är giltig i 15 minuter och kan bara användas en gång.`,
      ctaUrl: url,
      ctaLabel: 'Logga in'
    }),
    text: `Logga in på Glosan med länken nedan (giltig i 15 min):\n${url}\n\nGlosan · ${canonicalFrontendUrl()}`
  });
  return true;
}

const generateAccessToken = (user) => {
  const roles = user.roles && user.roles.length > 0 ? user.roles : ['user'];
  return jwt.sign(
    { id: user._id, roles },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m' }
  );
};

// Refresh-token formatas som "family.secret" i cookien. Server slår upp
// användaren via family och jämför hash av secret med lagrade. Vid mismatch
// på sercret men träff på family → replay → revokera hela familjen.
const FAMILY_LEN = 32; // 16 bytes hex = 32 chars
const SECRET_LEN = 64; // 32 bytes hex = 64 chars

const generateRefreshTokenParts = () => ({
  family: crypto.randomBytes(16).toString('hex'),
  secret: crypto.randomBytes(32).toString('hex')
});

const hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

const parseRefreshToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  if (token.length !== FAMILY_LEN + 1 + SECRET_LEN) return null;
  if (token[FAMILY_LEN] !== '.') return null;
  const family = token.slice(0, FAMILY_LEN);
  const secret = token.slice(FAMILY_LEN + 1);
  if (!/^[a-f0-9]+$/.test(family) || !/^[a-f0-9]+$/.test(secret)) return null;
  return { family, secret };
};

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// Initial issue (login / register): nytt family-ID och secret.
const issueTokens = async (user, res) => {
  const { family, secret } = generateRefreshTokenParts();
  user.refreshTokenFamily = family;
  user.refreshTokenHash = hashSecret(secret);
  await user.save();
  res.cookie('refreshToken', `${family}.${secret}`, refreshCookieOptions);
  return generateAccessToken(user);
};

// Rotate (refresh): behåll family-ID, rotera bara secret. Att family består
// är det som gör replay-detection möjlig — när ett *gammalt* secret kommer
// in med rätt family är det bevisat att någon spelar upp en stulen token.
const rotateRefreshSecret = async (user, res) => {
  const { secret } = generateRefreshTokenParts();
  user.refreshTokenHash = hashSecret(secret);
  await user.save();
  res.cookie('refreshToken', `${user.refreshTokenFamily}.${secret}`, refreshCookieOptions);
  return generateAccessToken(user);
};

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password, ageConsent } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    if (ageConsent !== true) {
      return res.status(400).json({
        error: 'Du måste bekräfta att du är minst 13 år eller har en förälders tillåtelse.'
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }]
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Registration failed. Please check your details and try again.' });
    }

    const user = new User({ username, email, password, roles: ['user'], ageConsent: true });
    const accessToken = await issueTokens(user, res);

    // Skicka verify-email best-effort — om Resend krånglar ska register
    // fortfarande lyckas; användaren kan begära en ny länk via banner.
    sendVerifyEmail(user).catch((err) => {
      console.error('Verify-email send failed (non-fatal):', err.message);
    });

    res.status(201).json({ token: accessToken, user: user.toJSON() });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/verify-email — body { token }
// Konsumerar en email-verify-token och markerar user.emailVerified = true.
router.post('/verify-email', authLimiter, async (req, res) => {
  try {
    const { token } = req.body;
    const doc = await consumeEmailToken({ token, kind: 'verify-email' });
    if (!doc) {
      return res.status(400).json({ error: 'Länken är ogiltig eller har gått ut.' });
    }
    await User.updateOne(
      { _id: doc.user },
      { $set: { emailVerified: true, emailVerifiedAt: new Date() } }
    );
    res.json({ message: 'Email verified' });
  } catch (err) {
    console.error('Verify-email error:', err);
    res.status(500).json({ error: 'Verify failed' });
  }
});

// POST /api/auth/resend-verification — kräver auth.
// Invaliderar tidigare oanvända verify-tokens för denna user och skickar
// ett nytt mail. Striktare rate-limit (5/timme) så ingen kan spamma
// email-skickning.
router.post('/resend-verification', requireAuth, emailLimiter, async (req, res) => {
  try {
    if (!emailService.isEnabled()) {
      return res.status(503).json({ error: 'Email-tjänsten är inte konfigurerad på servern.' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Din email är redan bekräftad.' });
    }
    await Token.deleteMany({ user: user._id, kind: 'verify-email', usedAt: null });
    await sendVerifyEmail(user);
    res.json({ message: 'Verifieringsmail skickat. Kolla din inbox.' });
  } catch (err) {
    console.error('Resend-verification error:', err);
    res.status(502).json({ error: 'Kunde inte skicka mail just nu.' });
  }
});

// POST /api/auth/forgot-password — body { email }
// Returnerar alltid 200 även om emailen inte finns — anti-enumeration.
// Strikt rate-limit eftersom det skickar mail.
router.post('/forgot-password', emailLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const ack = { message: 'Om kontot finns har vi skickat ett mail med återställningslänk.' };
    if (!email || typeof email !== 'string') return res.json(ack);

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (user && emailService.isEnabled()) {
      // Invalidera tidigare reset-tokens så bara senaste länken funkar
      await Token.deleteMany({ user: user._id, kind: 'reset-password', usedAt: null });
      try {
        await sendResetPasswordEmail(user);
      } catch (mailErr) {
        console.error('Reset-password mail failed:', mailErr.message);
        // Logga men returnera ändå 200 så vi inte avslöjar om email finns
      }
    }
    res.json(ack);
  } catch (err) {
    console.error('Forgot-password error:', err);
    res.json({ message: 'Om kontot finns har vi skickat ett mail med återställningslänk.' });
  }
});

// POST /api/auth/reset-password — body { token, password }
// Konsumerar en reset-token, sätter nytt lösenord, rensar refresh-tokens
// (tvingar omloggning på alla enheter — säkerhetspraxis).
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Lösenord krävs.' });
    }
    const doc = await consumeEmailToken({ token, kind: 'reset-password' });
    if (!doc) {
      return res.status(400).json({ error: 'Länken är ogiltig eller har gått ut.' });
    }
    const user = await User.findById(doc.user);
    if (!user) return res.status(400).json({ error: 'Användaren hittades inte.' });

    user.password = password; // pre-save-hook validerar + hashar
    user.refreshTokenHash = null;   // invalidera alla refresh-tokens
    user.refreshTokenFamily = null;
    // Reset-länken är beviset att hen kontrollerar email-adressen, så
    // markera den som verifierad om den inte redan var det.
    if (!user.emailVerified) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
    }
    await user.save();
    res.json({ message: 'Lösenord uppdaterat. Logga in med det nya.' });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    console.error('Reset-password error:', error);
    res.status(500).json({ error: 'Kunde inte återställa lösenord.' });
  }
});

// POST /api/auth/magic-link — body { email }
// Returnerar alltid 200, anti-enumeration som forgot-password.
router.post('/magic-link', emailLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const ack = { message: 'Om kontot finns har vi skickat en inloggningslänk.' };
    if (!email || typeof email !== 'string') return res.json(ack);

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (user && emailService.isEnabled()) {
      await Token.deleteMany({ user: user._id, kind: 'magic-link', usedAt: null });
      try {
        await sendMagicLinkEmail(user);
      } catch (mailErr) {
        console.error('Magic-link mail failed:', mailErr.message);
      }
    }
    res.json(ack);
  } catch (err) {
    console.error('Magic-link error:', err);
    res.json({ message: 'Om kontot finns har vi skickat en inloggningslänk.' });
  }
});

// POST /api/auth/magic-link/consume — body { token }
// Validerar magic-link-token och ger access + refresh-tokens precis som
// login. En lyckad consume markerar också email som verifierad (eftersom
// magic-link bevisar att hen läser mailet på adressen).
router.post('/magic-link/consume', authLimiter, async (req, res) => {
  try {
    const { token } = req.body;
    const doc = await consumeEmailToken({ token, kind: 'magic-link' });
    if (!doc) {
      return res.status(400).json({ error: 'Länken är ogiltig eller har gått ut.' });
    }
    const user = await User.findById(doc.user);
    if (!user) return res.status(400).json({ error: 'Användaren hittades inte.' });

    if (!user.emailVerified) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
    }
    const accessToken = await issueTokens(user, res);
    res.json({ token: accessToken, user: user.toJSON() });
  } catch (err) {
    console.error('Magic-link consume error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({
      $or: [{ username: username.toLowerCase() }, { email: username.toLowerCase() }]
    });

    // Run bcrypt.compare even when user is missing to prevent timing-based enumeration
    const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const isMatch = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = await issueTokens(user, res);
    res.json({ token: accessToken, user: user.toJSON() });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', refreshLimiter, async (req, res) => {
  const parsed = parseRefreshToken(req.cookies?.refreshToken);
  if (!parsed) {
    res.clearCookie('refreshToken', refreshCookieOptions);
    return res.status(401).json({ error: 'No refresh token' });
  }
  try {
    const user = await User.findOne({ refreshTokenFamily: parsed.family });
    if (!user) {
      res.clearCookie('refreshToken', refreshCookieOptions);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    // Replay-detection: family matchar men hashen gör inte → stulen historisk
    // token presenteras. Revokera hela familjen.
    if (hashSecret(parsed.secret) !== user.refreshTokenHash) {
      user.refreshTokenFamily = null;
      user.refreshTokenHash = null;
      await user.save();
      res.clearCookie('refreshToken', refreshCookieOptions);
      console.warn('[security] refresh-token replay detected, family revoked', { userId: String(user._id) });
      return res.status(401).json({ error: 'Token compromised — please log in again' });
    }
    const accessToken = await rotateRefreshSecret(user, res);
    res.json({ token: accessToken });
  } catch (error) {
    console.error('Refresh error:', error.message);
    res.clearCookie('refreshToken', refreshCookieOptions);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// Logout authenticatas via refresh-cookien istället för access-token, så
// server-state rensas även när klienten har varit borta så länge att access
// hunnit gå ut. Saknad/ogiltig cookie ger ändå 200 — det är inte ett fel
// att försöka logga ut två gånger.
router.post('/logout', refreshLimiter, async (req, res) => {
  const parsed = parseRefreshToken(req.cookies?.refreshToken);
  try {
    if (parsed) {
      const user = await User.findOne({ refreshTokenFamily: parsed.family });
      if (user) {
        user.refreshTokenFamily = null;
        user.refreshTokenHash = null;
        await user.save();
      }
    }
    res.clearCookie('refreshToken', refreshCookieOptions);
    res.json({ message: 'Logged out' });
  } catch (error) {
    console.error('Logout error:', error.message);
    res.clearCookie('refreshToken', refreshCookieOptions);
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toJSON() });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;
