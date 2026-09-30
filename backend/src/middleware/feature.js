const User = require('../models/User');
const { hasFeature, FEATURE_FIELDS } = require('../config/features');

/**
 * Släpp bara igenom användare som har funktionsflaggan `key` (efter
 * requireAuth). Flaggan läses från databasen vid varje anrop — inte från
 * JWT:n — så när admin slår på/av den gäller det direkt, utan omloggning.
 *
 * En avstängd modul svarar 404 precis som en okänd route: en dold modul ska
 * inte gå att upptäcka genom att prova URL:er.
 */
function requireFeature(key) {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).select(FEATURE_FIELDS).lean();
      if (!user || !hasFeature(user, key)) {
        return res.status(404).json({ error: 'Route not found' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireFeature };
