// Registreringsformuläret kontrolleras FÖRE registerLimiter (routes/auth.js):
// ett formulär med fel — för kort lösenord, ogiltig e-post, ingen
// åldersbekräftelse — ska inte äta upp klassens kvot av nya konton. Allt som
// klarar kontrollen räknas sedan, oavsett hur det går (även om klienten
// lägger på innan svaret), så taket inte går att komma runt.
const User = require('../models/User');

async function validateRegistration(req, res, next) {
  const { username, email, password, ageConsent } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }
  if (ageConsent !== true) {
    return res.status(400).json({
      error: 'Du måste bekräfta att du är minst 13 år eller har en förälders tillåtelse.'
    });
  }
  // Samma validering som när kontot sparas (modellens regler), utan databasen.
  const user = new User({ username, email, password, roles: ['user'], ageConsent: true });
  try {
    await user.validate();
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map((e) => e.message).join(', ') });
    }
    return next(error);
  }
  req.newUser = user;
  next();
}

module.exports = { validateRegistration };
