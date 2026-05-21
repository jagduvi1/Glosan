require('dotenv').config();

const requiredEnv = ['JWT_SECRET'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// JWT_SECRET måste vara tillräckligt långt + inte vara placeholdern från
// .env.example. HS256 signering med en svag eller läckt nyckel = trivial
// auth-bypass via förfalskade tokens.
const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}
if (/change[-_]?me|placeholder|example|secret|please[-_]?change/i.test(jwtSecret)) {
  console.error('FATAL: JWT_SECRET looks like an example placeholder. Generate a real random secret (e.g. `openssl rand -base64 48`).');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('Warning: ANTHROPIC_API_KEY not set — /api/ai/* routes will return 503.');
}

const http = require('http');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const { initSockets } = require('./src/socket');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  // Egen HTTP-server så vi kan dela porten mellan Express och Socket.IO.
  const server = http.createServer(app);
  initSockets(server);
  server.listen(PORT, () => {
    console.log(`Glosan backend running on port ${PORT}`);
  });
});
