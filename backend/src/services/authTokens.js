const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Central plats för access/refresh-token-paret och refresh-cookien. Delas av
// lösenordsflödet (routes/auth.js) och Google-SSO-flödet (routes/oauth.js) så
// båda skapar IDENTISKA sessioner — samma JWT-claims, samma roterande
// refresh-cookie med replay-detection. Speglar Cellarions
// services/authTokens.js i förenklad form (Glosan har en session per konto,
// inte per enhet).

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
// på secret men träff på family → replay → revokera hela familjen.
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

// Delas med OAuth-state-cookien (services/oauthStateStore.js) så båda
// cookies följer samma http/https-regel.
const COOKIE_SECURE = process.env.NODE_ENV === 'production';

// sameSite 'strict' fungerar även för Google-callbacken: SameSite begränsar
// när en cookie SKICKAS, inte när den får sättas — och Set-Cookie på en
// top-level-navigering (redirecten tillbaka från Google) lagras alltid.
// SPA:n läser sedan cookien via same-site-anrop till /api/auth/refresh.
const refreshCookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// Initial issue (login / register / magic-link / SSO): nytt family-ID och secret.
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

module.exports = {
  generateAccessToken,
  generateRefreshTokenParts,
  hashSecret,
  parseRefreshToken,
  COOKIE_SECURE,
  refreshCookieOptions,
  issueTokens,
  rotateRefreshSecret
};
