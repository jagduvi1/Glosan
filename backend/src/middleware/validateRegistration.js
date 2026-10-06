// Registreringsformuläret kontrolleras FÖRE registerLimiter (routes/auth.js):
// ett formulär med fel — för kort lösenord, ogiltig e-post, ingen
// åldersbekräftelse, ett upptaget namn — ska inte äta upp klassens kvot av nya
// konton. Allt som klarar kontrollen räknas sedan, oavsett hur det går (även
// om klienten lägger på innan svaret), så taket inte går att komma runt.
const User = require('../models/User');
const { heldUsernameFilter } = require('../config/username');
const { usernameProblem } = require('../services/username');

// Samma vaga svar som routen alltid gett: det säger inte om det är namnet
// eller e-posten som är upptagen.
const TAKEN = 'Registration failed. Please check your details and try again.';

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
  // Samma regler för namnet som när man byter det (services/username.js):
  // tecken, längd, inga Glosan-liknande namn, inget @ (inloggningen tar namn
  // ELLER e-post).
  const problem = usernameProblem(user.username);
  if (problem) return res.status(400).json({ error: problem });
  // Ett upptaget namn är också ett fel i formuläret: en klass där många heter
  // samma sak provar nya namn, och det ska inte stänga ute resten av klassen.
  // Modellen har gjort namn och e-post gemena och trimmade. Ett namn någon
  // just bytt bort hålls åt hen en vecka.
  try {
    if (await User.exists({ $or: [{ email: user.email }, { username: user.username }, heldUsernameFilter(user.username)] })) {
      return res.status(400).json({ error: TAKEN });
    }
  } catch (error) {
    return next(error);
  }
  req.newUser = user;
  next();
}

module.exports = { validateRegistration, TAKEN };
