const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    lowercase: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username too long']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    validate: {
      validator: (v) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/.test(v),
      message: 'Password must be at least 10 characters and include an uppercase letter, lowercase letter, and number'
    }
  },
  roles: {
    type: [String],
    enum: ['user', 'admin'],
    default: ['user'],
    validate: {
      validator: (arr) => arr.length > 0,
      message: 'User must have at least one role'
    }
  },
  refreshTokenHash: { type: String, default: null },
  // Familje-ID för refresh-token. Lagras separat så vi kan slå upp användaren
  // utan att exponera tokenens hemliga del. Vid en presentation av (familyId,
  // secret) där familjet hittas men hashen inte matchar → någon kör replay
  // av en stulen historisk token; hela familjen revokeras (force re-login).
  refreshTokenFamily: { type: String, default: null, index: true, sparse: true },
  // 6-char shareable identity code for the friends feature. Lazy-generated on
  // first /api/me/friend-code request. Unique across all users. INGEN default
  // — sparse-index på MongoDB inkluderar `null`-värden i indexet vilket gör
  // att flera dokument med null kolliderar; en odefinierad fält hoppas över.
  friendCode: { type: String, unique: true, sparse: true, index: true },
  plan: {
    type: String,
    enum: ['free', 'basic', 'premium'],
    default: 'free'
  },
  trial: {
    plan: { type: String, enum: ['free', 'basic', 'premium', null], default: null },
    until: { type: Date, default: null }
  },
  hasUsedTrial: { type: Boolean, default: false },
  // GDPR-grund: sätts vid registrering när användaren bekräftar att de
  // är minst 13 år eller har förälders/vårdnadshavares tillåtelse.
  // Befintliga konton (registrerade innan kravet infördes) har false —
  // vi kräver bekräftelse bara vid nya registreringar.
  ageConsent: { type: Boolean, default: false },
  // Email-verifiering är mjuk: nya konton skapas med false och får en
  // banner i UI som påminner om att klicka i mailet, men de kan logga
  // in och använda allt direkt. emailVerifiedAt sätts samtidigt så vi
  // kan visa "verifierad <datum>" i admin-vyn.
  emailVerified: { type: Boolean, default: false },
  emailVerifiedAt: { type: Date, default: null },
  aiUsage: {
    count: { type: Number, default: 0, min: 0 },
    monthKey: { type: String, default: '' }
  },
  avatar: {
    kind: { type: String, enum: ['initial', 'glo', 'emoji'], default: 'initial' },
    value: { type: String, default: '', maxlength: 16 }
  },
  xp: { type: Number, default: 0, min: 0 },
  // Per-language XP: { fr: 120, de: 50, ... }. `xp` above stays as the
  // denormalized total (sum of values here) so avatar unlocks keep working.
  languageXp: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  streak: {
    current: { type: Number, default: 0, min: 0 },
    longest: { type: Number, default: 0, min: 0 },
    lastActiveDay: { type: Date, default: null }
  },
  quizzesCompleted: { type: Number, default: 0, min: 0 },
  perfectRounds: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokenHash;
  delete obj.refreshTokenFamily;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
