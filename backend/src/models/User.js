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

userSchema.methods.setRefreshToken = function (token) {
  this.refreshTokenHash = crypto.createHash('sha256').update(token).digest('hex');
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokenHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
