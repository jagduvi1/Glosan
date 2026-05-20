const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const healthRoute = require('./routes/health');
const authRoute = require('./routes/auth');
const listsRoute = require('./routes/lists');
const glosorRoute = require('./routes/glosor');
const aiRoute = require('./routes/ai');
const meRoute = require('./routes/me');
const categoriesRoute = require('./routes/categories');

const app = express();

app.set('trust proxy', 2);

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'none'"] }
  }
}));

app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '64kb' }));

const corsOrigin = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000');
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.warn('[security] FRONTEND_URL is not set — CORS will block cross-origin requests in production');
}
app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests, please try again later' })
});
app.use('/api/', apiLimiter);

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  handler: (req, res) => res.status(429).json({ error: 'Too many write requests, please try again later' })
});
app.use('/api/', writeLimiter);

app.use('/api/health', healthRoute);
app.use('/api/auth', authRoute);
app.use('/api/lists', listsRoute);
app.use('/api', glosorRoute);
app.use('/api/ai', aiRoute);
app.use('/api/me', meRoute);
app.use('/api/categories', categoriesRoute);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status >= 500
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({ error: message });
});

module.exports = app;
