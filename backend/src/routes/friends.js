const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { generateUniqueFriendCode } = require('../utils/friendCode');

const router = express.Router();

// Strikt limiter på "lägg till med kod" — alfabetet är 32 tecken över 6
// positioner (~1G koder), men en angripare som kan testa 1000 per timme
// hittar en giltig kod inom hanterbar tid om vi inte begränsar. 20/timme
// per IP är gott och väl för en legitim användare.
const byCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    error: 'För många försök att lägga till kompis. Försök igen om en stund.'
  })
});

router.use(requireAuth);

// GET /api/me/friend-code — returns the user's own code, lazily generating
// one the first time it's asked for. Existing users from before the
// friends feature had no code; this fills it in transparently.
router.get('/friend-code', async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.friendCode) {
      user.friendCode = await generateUniqueFriendCode(User);
      await user.save();
    }
    res.json({ friendCode: user.friendCode });
  } catch (err) {
    console.error('Friend-code error:', err);
    res.status(500).json({ error: 'Failed to fetch friend code' });
  }
});

// GET /api/me/friends — list of {friend: {_id, username, avatar, friendCode, streak, xp}, addedAt}
router.get('/friends', async (req, res) => {
  try {
    const rows = await Friendship.find({ user: req.user.id })
      .populate('friend', 'username avatar friendCode streak xp')
      .sort({ addedAt: -1 })
      .lean();
    res.json({
      friends: rows.map((r) => ({
        _id: r.friend._id,
        username: r.friend.username,
        avatar: r.friend.avatar || { kind: 'initial', value: '' },
        friendCode: r.friend.friendCode,
        streak: {
          current: r.friend.streak?.current ?? 0,
          longest: r.friend.streak?.longest ?? 0
        },
        xp: r.friend.xp ?? 0,
        addedAt: r.addedAt
      }))
    });
  } catch (err) {
    console.error('Friends list error:', err);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// POST /api/me/friends/by-code — body: { code }. Looks up the code, creates
// the mutual friendship pair, returns the new friend. Idempotent — adding
// someone already in the friend list is a no-op.
router.post('/friends/by-code', byCodeLimiter, async (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code || code.length < 4) {
    return res.status(400).json({ error: 'Skriv in en kod på minst 4 tecken.' });
  }
  try {
    const target = await User.findOne({ friendCode: code });
    if (!target) {
      return res.status(404).json({ error: 'Ingen användare har den koden.' });
    }
    if (target._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Det där är din egen kod 🙂' });
    }

    // Insert both rows. Use upsert so duplicates don't 11000-error out.
    const now = new Date();
    await Friendship.updateOne(
      { user: req.user.id, friend: target._id },
      { $setOnInsert: { user: req.user.id, friend: target._id, addedAt: now } },
      { upsert: true }
    );
    await Friendship.updateOne(
      { user: target._id, friend: req.user.id },
      { $setOnInsert: { user: target._id, friend: req.user.id, addedAt: now } },
      { upsert: true }
    );

    res.json({
      friend: {
        _id: target._id,
        username: target.username,
        avatar: target.avatar || { kind: 'initial', value: '' },
        friendCode: target.friendCode,
        addedAt: now
      }
    });
  } catch (err) {
    console.error('Add friend error:', err);
    res.status(500).json({ error: 'Det gick inte att lägga till kompisen.' });
  }
});

// DELETE /api/me/friends/:friendId — removes both rows.
router.delete('/friends/:friendId', async (req, res) => {
  const friendId = req.params.friendId;
  if (!mongoose.Types.ObjectId.isValid(friendId)) {
    return res.status(400).json({ error: 'Invalid friend id' });
  }
  try {
    await Friendship.deleteOne({ user: req.user.id, friend: friendId });
    await Friendship.deleteOne({ user: friendId, friend: req.user.id });
    res.json({ message: 'Friendship removed' });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

module.exports = router;
