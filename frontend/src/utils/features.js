// Funktionsflaggor (dolda moduler). Backend skickar användarens EFFEKTIVA
// flaggor i user.features (egna + de som är på för alla), så frontend behöver
// bara fråga här. Katalogen finns i backend/src/config/features.js.
export function hasFeature(user, key) {
  return Array.isArray(user?.features) && user.features.includes(key);
}
