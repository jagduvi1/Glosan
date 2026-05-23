const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const InviteCode = require('../models/InviteCode');
const { randomCode } = require('../utils/friendCode');

const INVITE_TTL_DAYS = 7;
const INVITE_CODE_LENGTH = 8;
const MAX_ACTIVE_INVITES = 10;

// Hjälpare för att generera en engångskod som inte krockar med befintliga
// (varken InviteCode eller User.friendCode). 8 tecken (32^8 ≈ 1 trillion)
// gör att praktisk krock är försumbar, men vi loop:ar några gånger för
// säkerhets skull.
async function generateUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(INVITE_CODE_LENGTH);
    // eslint-disable-next-line no-await-in-loop
    const [existsInvite, existsFriend] = await Promise.all([
      InviteCode.findOne({ code }).select('_id').lean(),
      User.findOne({ friendCode: code }).select('_id').lean()
    ]);
    if (!existsInvite && !existsFriend) return code;
  }
  throw new Error('Kunde inte generera unik kod');
}

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

// GET /api/me/friends — list of {friend: {_id, username, avatar, streak, xp}, addedAt}
router.get('/friends', async (req, res) => {
  try {
    const rows = await Friendship.find({ user: req.user.id })
      .populate('friend', 'username avatar streak xp')
      .sort({ addedAt: -1 })
      .lean();
    res.json({
      friends: rows.map((r) => ({
        _id: r.friend._id,
        username: r.friend.username,
        avatar: r.friend.avatar || { kind: 'initial', value: '' },
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
// Letar BARA i InviteCode (engångs). Permanenta koder är borta — om
// någon skickar in en gammal 6-teckens kod får de "ingen användare".
router.post('/friends/by-code', byCodeLimiter, async (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code || code.length !== INVITE_CODE_LENGTH) {
    return res.status(400).json({ error: `Kompis-koder är ${INVITE_CODE_LENGTH} tecken långa.` });
  }
  try {
    const invite = await InviteCode.findOne({ code });
    if (!invite) {
      return res.status(404).json({ error: 'Ingen sådan kod finns.' });
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Den här koden har gått ut.' });
    }
    if (invite.usedBy) {
      return res.status(400).json({ error: 'Koden är redan använd.' });
    }
    const target = await User.findById(invite.user);
    if (!target) {
      return res.status(404).json({ error: 'Användaren finns inte längre.' });
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

    // Bränn engångskoden.
    invite.usedBy = req.user.id;
    invite.usedAt = now;
    await invite.save();

    // Belöna båda: 100 XP var + räkna upp referralCount för den som
    // skapade koden. Tröskelvärden låser upp rewards (badges/outfits).
    const REFERRAL_XP = 100;
    const REWARD_THRESHOLDS = [
      { count: 3,  key: 'student-hat' },   // 🎓 Studentmössa
      { count: 10, key: 'ambassador' }     // ⭐ Ambassadör-badge
    ];

    target.xp = (target.xp || 0) + REFERRAL_XP;
    target.referralCount = (target.referralCount || 0) + 1;
    const newlyUnlocked = [];
    for (const t of REWARD_THRESHOLDS) {
      if (target.referralCount >= t.count && !target.unlockedRewards.includes(t.key)) {
        target.unlockedRewards.push(t.key);
        newlyUnlocked.push(t.key);
      }
    }
    await target.save();

    // Lägg till XP för den nya kompisen (req.user)
    await User.updateOne(
      { _id: req.user.id },
      { $inc: { xp: REFERRAL_XP } }
    );

    res.json({
      friend: {
        _id: target._id,
        username: target.username,
        avatar: target.avatar || { kind: 'initial', value: '' },
        addedAt: now
      },
      reward: { xp: REFERRAL_XP, newlyUnlocked }
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

// GET /api/me/invite-codes — alla mina aktiva (ej använda + ej utgångna)
// engångskoder. Använda koder filtreras bort eftersom de är döda.
router.get('/invite-codes', async (req, res) => {
  try {
    const now = new Date();
    const codes = await InviteCode.find({
      user: req.user.id,
      usedBy: null,
      expiresAt: { $gt: now }
    }).sort({ createdAt: -1 }).lean();
    res.json({
      inviteCodes: codes.map((c) => ({
        _id: c._id,
        code: c.code,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt
      }))
    });
  } catch (err) {
    console.error('Invite-code list error:', err);
    res.status(500).json({ error: 'Failed to fetch invite codes' });
  }
});

// POST /api/me/invite-codes — skapa en ny engångskod (8 chars, 7 dagars
// giltighet, kan användas EN gång). Limit på MAX_ACTIVE_INVITES per user
// så ingen kan generera tusentals samtidigt.
router.post('/invite-codes', async (req, res) => {
  try {
    const now = new Date();
    const activeCount = await InviteCode.countDocuments({
      user: req.user.id,
      usedBy: null,
      expiresAt: { $gt: now }
    });
    if (activeCount >= MAX_ACTIVE_INVITES) {
      return res.status(400).json({
        error: `Du har redan ${MAX_ACTIVE_INVITES} aktiva engångskoder. Ta bort en innan du skapar ny.`
      });
    }
    const code = await generateUniqueInviteCode();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invite = await InviteCode.create({
      code,
      user: req.user.id,
      expiresAt
    });
    res.status(201).json({
      inviteCode: {
        _id: invite._id,
        code: invite.code,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt
      }
    });
  } catch (err) {
    console.error('Invite-code create error:', err);
    res.status(500).json({ error: 'Failed to create invite code' });
  }
});

// DELETE /api/me/invite-codes/:id — ångra en aktiv engångskod (t.ex. om
// du delade den fel kompis). Använda koder kan inte tas bort.
router.delete('/invite-codes/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  try {
    const invite = await InviteCode.findOne({ _id: id, user: req.user.id });
    if (!invite) return res.status(404).json({ error: 'Invite-kod hittades inte' });
    await invite.deleteOne();
    res.json({ message: 'Invite-kod borttagen' });
  } catch (err) {
    console.error('Invite-code delete error:', err);
    res.status(500).json({ error: 'Failed to delete invite code' });
  }
});

module.exports = router;
