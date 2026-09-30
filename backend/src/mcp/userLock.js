// Ett anrop i taget per användare för MCP-verktyg som skapar innehåll: två
// likadana anrop samtidigt (en omsändning, parallella verktygsanrop) ska inte
// båda passera en dubblett- eller takkontroll som läser först och skriver
// sedan. Backend kör i en process, så ett lås i minnet räcker.
const userLocks = new Map();

async function withUserLock(userId, fn) {
  const key = String(userId);
  const prev = userLocks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const chain = prev.then(() => mine);
  userLocks.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (userLocks.get(key) === chain) userLocks.delete(key);
  }
}

module.exports = { withUserLock };
