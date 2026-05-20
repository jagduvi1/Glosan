const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
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
