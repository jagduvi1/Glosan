const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { registerLiveDuel } = require('./liveDuel');

// Socket.IO-grund för Glosan. Auth sker via JWT i handshake (auth.token);
// klienten skickar samma access-token som REST-anrop. Vid invalid token
// avvisar vi anslutningen.
function initSockets(httpServer) {
  // Stöd kommaseparerad FRONTEND_URL för parallell hostning på flera domäner.
  const socketOrigin = (() => {
    const raw = process.env.FRONTEND_URL;
    if (!raw) return process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000';
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length === 1 ? list[0] : list;
  })();
  const io = new Server(httpServer, {
    cors: {
      // Spegla express-CORS — credentials behövs ej eftersom vi använder
      // Bearer-token i handshake, inte cookies.
      origin: socketOrigin,
      methods: ['GET', 'POST']
    },
    path: '/api/socket.io'
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      socket.user = { id: decoded.id, roles: decoded.roles || ['user'] };
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  registerLiveDuel(io);

  io.on('connection', (socket) => {
    // Logga bara på debug-nivå — annars spammar varje refresh.
    // console.log('[socket] connected', socket.user.id);
  });

  return io;
}

module.exports = { initSockets };
