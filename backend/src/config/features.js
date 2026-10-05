// Funktionsflaggor — för moduler som byggs dolt och släpps stegvis.
// En flagga slås på per användare (admin-sidan, User.features) eller för
// ALLA: med `released: true` här när modulen är släppt, eller via
// env-variabeln FEATURES_FOR_ALL (kommaseparerad, t.ex. "study") för att prova
// ett släpp utan ny kod. FEATURES_DISABLED är nödbromsen: en flagga där är av
// för alla, vad som än står här eller på kontona (starta om backend). Enda
// källan till sanning för backend, MCP och (via User.toJSON) frontend.
//
// En släppt modul behåller sin flagga: nödbromsen och admins avstängning per
// konto fungerar som förut, och en AI som anslöts innan modulen fanns når den
// inte förrän användaren anslutit igen och godkänt (McpToken.modules).

const FEATURES = {
  study: {
    label: 'Plugga',
    description: 'Skolämnen: områden med genomgångar, kort, övningar och prov — innehållet skapas via MCP.',
    released: true // för alla sedan v0.1.39
  }
};

const FEATURE_KEYS = Object.keys(FEATURES);

const envList = (name) => (process.env[name] || '')
  .split(',')
  .map((s) => s.trim())
  .filter((k) => FEATURE_KEYS.includes(k));

/** Flaggor som är på för alla just nu: släppta moduler + FEATURES_FOR_ALL. Okända nycklar ignoreras. */
function featuresForAll() {
  return [...new Set([...FEATURE_KEYS.filter((k) => FEATURES[k].released), ...envList('FEATURES_FOR_ALL')])];
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
