// Funktionsflaggor — för moduler som byggs dolt och släpps stegvis.
// En flagga slås på per användare (admin-sidan, User.features) eller för
// ALLA via env-variabeln FEATURES_FOR_ALL (kommaseparerad, t.ex. "study") när
// modulen är redo att släppas. Enda källan till sanning för backend, MCP och
// (via User.toJSON) frontend.

const FEATURES = {
  study: {
    label: 'Plugga',
    description: 'Skolämnen: områden med genomgångar, kort, övningar och prov — innehållet skapas via MCP.'
  }
};

const FEATURE_KEYS = Object.keys(FEATURES);

/** Flaggor som är på för alla just nu (FEATURES_FOR_ALL). Okända nycklar ignoreras. */
function featuresForAll() {
  return (process.env.FEATURES_FOR_ALL || '')
    .split(',')
    .map((s) => s.trim())
    .filter((k) => FEATURE_KEYS.includes(k));
}

/** Användarens effektiva flaggor: egna + de som är på för alla. */
function effectiveFeatures(user) {
  const own = Array.isArray(user?.features) ? user.features.filter((k) => FEATURE_KEYS.includes(k)) : [];
  return [...new Set([...own, ...featuresForAll()])];
}

function hasFeature(user, key) {
  return effectiveFeatures(user).includes(key);
}

module.exports = { FEATURES, FEATURE_KEYS, featuresForAll, effectiveFeatures, hasFeature };
