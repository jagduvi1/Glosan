const mongoose = require('mongoose');

// Two-row friendship pattern: when A and B become friends, we insert
// {user: A, friend: B} AND {user: B, friend: A}. Querying "all friends of X"
// is then a single find({ user: X }) populating friend. Removing the
// friendship deletes both rows.
const friendshipSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  friend: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  addedAt: { type: Date, default: Date.now }
});

friendshipSchema.index({ user: 1, friend: 1 }, { unique: true });

module.exports = mongoose.model('Friendship', friendshipSchema);
