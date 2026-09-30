// Funktionsflaggor — för moduler som byggs dolt och släpps stegvis.
// En flagga slås på per användare (admin-sidan, User.features) eller för
// ALLA via env-variabeln FEATURES_FOR_ALL (kommaseparerad, t.ex. "study") när
// modulen är redo att släppas. FEATURES_DISABLED är nödbromsen: en flagga där
// är av för alla, vad som än står på kontona (starta om backend). Enda källan
// till sanning för backend, MCP och (via User.toJSON) frontend.

const FEATURES = {
  study: {
    label: 'Plugga',
    description: 'Skolämnen: områden med genomgångar, kort, övningar och prov — innehållet skapas via MCP.'
  }
};

const FEATURE_KEYS = Object.keys(FEATURES);

const envList = (name) => (process.env[name] || '')
  .split(',')
  .map((s) => s.trim())
  .filter((k) => FEATURE_KEYS.includes(k));

/** Flaggor som är på för alla just nu (FEATURES_FOR_ALL). Okända nycklar ignoreras. */
function featuresForAll() {
  return envList('FEATURES_FOR_ALL');
}

/** Flaggor som är AV för alla (FEATURES_DISABLED) — nödbroms. */
function featuresDisabled() {
  return envList('FEATURES_DISABLED');
}

/**
 * Användarens effektiva flaggor: egna + de som är på för alla, minus dem
 * admin blockerat för kontot (User.featureBlocks). Läs med projektionen
 * FEATURE_FIELDS.
 */
function effectiveFeatures(user) {
  const own = Array.isArray(user?.features) ? user.features.filter((k) => FEATURE_KEYS.includes(k)) : [];
  const blocked = new Set([...(Array.isArray(user?.featureBlocks) ? user.featureBlocks : []), ...featuresDisabled()]);
  return [...new Set([...own, ...featuresForAll()])].filter((k) => !blocked.has(k));
}

/** Fälten effectiveFeatures behöver, för .select(). */
const FEATURE_FIELDS = 'features featureBlocks';

function hasFeature(user, key) {
  return effectiveFeatures(user).includes(key);
}

module.exports = { FEATURES, FEATURE_KEYS, FEATURE_FIELDS, featuresForAll, featuresDisabled, effectiveFeatures, hasFeature };
