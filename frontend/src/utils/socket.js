// Lazy singleton för Socket.IO-anslutningen. socket.io-client (~40 KB gz)
// laddas dynamiskt så att appen inte drar in det i main-chunken — bara
// LiveDuel-sidan triggar import. Återanvänd via getSocket(token) som
// returnerar en Promise.
let socketPromise = null;
let lastToken = null;
let socket = null;

export async function getSocket(token) {
  if (!token) {
    closeSocket();
    return null;
  }
  if (socket && lastToken === token && socket.connected) {
    return socket;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
    socketPromise = null;
  }
  if (!socketPromise) {
    socketPromise = (async () => {
      const { io } = await import('socket.io-client');
      socket = io({
        path: '/api/socket.io',
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5
      });
      lastToken = token;
      return socket;
    })();
  }
  return socketPromise;
}

export function closeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socketPromise = null;
  lastToken = null;
}
