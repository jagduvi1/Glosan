import { io } from 'socket.io-client';

// En per-tab socket-anslutning. Vi behåller en lazy singleton så
// flera komponenter kan dela samma anslutning utan att vi öppnar två
// stycken samtidigt. Stänger om token försvinner (logout).
let socket = null;
let lastToken = null;

export function getSocket(token) {
  if (!token) {
    if (socket) {
      socket.disconnect();
      socket = null;
      lastToken = null;
    }
    return null;
  }
  if (socket && lastToken === token && socket.connected) {
    return socket;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io({
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5
  });
  lastToken = token;
  return socket;
}

export function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    lastToken = null;
  }
}
