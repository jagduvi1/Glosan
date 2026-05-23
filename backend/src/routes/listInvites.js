const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { loadOwnedList } = require('../middleware/ownership');
const ListInvite = require('../models/ListInvite');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { randomCode } = require('../utils/friendCode');

const router = express.Router();

const INVITE_CODE_LENGTH = 8;
const MAX_ACTIVE_INVITES_PER_LIST = 3;

// Skapande är dyrt (DB-write + collision-check) så vi begränsar — en
// person ska inte kunna spamma fram tusentals invites.
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'För många nya invites — vänta lite.' })
});

async function generateUniqueListInviteCode() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(INVITE_CODE_LENGTH);
    // eslint-disable-next-line no-await-in-loop
    const exists = await ListInvite.findOne({ code }).select('_id').lean();
    if (!exists) return code;
  }
  throw new Error('Kunde inte generera unik invite-kod');
}

// POST /api/lists/:id/share-link — kräver ägarskap
// Body: { ttlDays: 1|7|30, maxUses: number }
router.post('/lists/:id/share-link', requireAuth, createLimiter, loadOwnedList(), async (req, res) => {
  try {
    const ttlDays = Math.min(Math.max(Number(req.body.ttlDays) || 7, 1), 30);
    const maxUses = Math.min(Math.max(Number(req.body.maxUses) || 30, 1), 1000);

    // Limita antal samtidigt aktiva invites per lista
    const active = await ListInvite.countDocuments({
      list: req.list._id,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    });
    if (active >= MAX_ACTIVE_INVITES_PER_LIST) {
      return res.status(429).json({
        error: `Du har redan ${active} aktiva invites för den här listan. Avaktivera någon först.`
      });
    }

    const code = await generateUniqueListInviteCode();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const invite = await ListInvite.create({
      list: req.list._id,
      creator: req.user.id,
      code,
      expiresAt,
      maxUses
    });

    res.status(201).json({
      invite: {
        _id: invite._id,
        code: invite.code,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
        usedCount: 0
      }
    });
  } catch (err) {
    console.error('Create list-invite error:', err);
    res.status(500).json({ error: 'Kunde inte skapa invite-länk.' });
  }
});

// GET /api/lists/:id/share-links — lista mina aktiva invites för listan
router.get('/lists/:id/share-links', requireAuth, loadOwnedList(), async (req, res) => {
  try {
    const invites = await ListInvite.find({ list: req.list._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      invites: invites.map((i) => ({
        _id: i._id,
        code: i.code,
        expiresAt: i.expiresAt,
        maxUses: i.maxUses,
        usedCount: i.usedBy.length,
        revoked: Boolean(i.revokedAt),
        createdAt: i.createdAt
      }))
    });
  } catch (err) {
    console.error('List share-links error:', err);
    res.status(500).json({ error: 'Kunde inte hämta invite-länkar.' });
  }
});

// DELETE /api/lists/:id/share-link/:code — revokera (mjukt — sätter revokedAt)
router.delete('/lists/:id/share-link/:code', requireAuth, loadOwnedList(), async (req, res) => {
  try {
    const invite = await ListInvite.findOne({
      code: req.params.code,
      list: req.list._id,
      creator: req.user.id
    });
    if (!invite) return res.status(404).json({ error: 'Invite hittades inte.' });
    invite.revokedAt = new Date();
    await invite.save();
    res.json({ message: 'Invite-länk avaktiverad.' });
  } catch (err) {
    console.error('Revoke list-invite error:', err);
    res.status(500).json({ error: 'Kunde inte avaktivera invite.' });
  }
});

// GET /api/list-invite/:code — public preview, ingen auth
// Frontend visar "X delar listan Y med dig — registrera/logga in för att acceptera"
router.get('/list-invite/:code', async (req, res) => {
  try {
    const invite = await ListInvite.findOne({ code: req.params.code });
    if (!invite || !invite.isActive()) {
      return res.status(404).json({ error: 'Den här länken är ogiltig eller har gått ut.' });
    }
    const [list, creator] = await Promise.all([
      GlosList.findById(invite.list, 'title description sourceLang targetLang').lean(),
      User.findById(invite.creator, 'username avatar').lean()
    ]);
    if (!list || !creator) {
      return res.status(404).json({ error: 'Listan eller skaparen finns inte längre.' });
    }
    const glosCount = await Glos.countDocuments({ list: list._id });
    res.json({
      list: {
        title: list.title,
        description: list.description,
        sourceLang: list.sourceLang,
        targetLang: list.targetLang,
        glosCount
      },
      creator: {
        username: creator.username,
        avatar: creator.avatar || { kind: 'initial', value: '' }
      },
      expiresAt: invite.expiresAt,
      remainingUses: invite.maxUses - invite.usedBy.length
    });
  } catch (err) {
    console.error('List-invite preview error:', err);
    res.status(500).json({ error: 'Kunde inte ladda invite-länken.' });
  }
});

// POST /api/list-invite/:code/accept — kräver auth
// Kopierar listan + glosor till requestern + skapar friendship med creator.
router.post('/list-invite/:code/accept', requireAuth, async (req, res) => {
  try {
    const invite = await ListInvite.findOne({ code: req.params.code });
    if (!invite || !invite.isActive()) {
      return res.status(404).json({ error: 'Den här länken är ogiltig eller har gått ut.' });
    }
    if (invite.creator.toString() === req.user.id) {
      return res.status(400).json({ error: 'Du kan inte acceptera din egen invite.' });
    }
    if (invite.usedBy.some((u) => u.toString() === req.user.id)) {
      return res.status(400).json({ error: 'Du har redan använt den här länken.' });
    }

    // Hämta originalet
    const original = await GlosList.findById(invite.list);
    if (!original) return res.status(404).json({ error: 'Listan finns inte längre.' });
    const originalGlosor = await Glos.find({ list: original._id }).lean();

    // Kopiera lista
    const copy = await GlosList.create({
      user: req.user.id,
      title: original.title,
      description: original.description,
      sourceLang: original.sourceLang,
      targetLang: original.targetLang,
      categoryId: null
    });

    // Kopiera glosor (stripa user-specifik stats)
    if (originalGlosor.length > 0) {
      await Glos.insertMany(
        originalGlosor.map((g) => ({
          list: copy._id,
          source: g.source,
          target: g.target,
          notes: g.notes,
          exampleSentence: g.exampleSentence,
          extra: g.extra,
          stats: { correct: 0, wrong: 0, lastReviewedAt: null }
        }))
      );
    }

    // Lägg till båda som vänner (upsert)
    const now = new Date();
    await Friendship.updateOne(
      { user: req.user.id, friend: invite.creator },
      { $setOnInsert: { user: req.user.id, friend: invite.creator, addedAt: now } },
      { upsert: true }
    );
    await Friendship.updateOne(
      { user: invite.creator, friend: req.user.id },
      { $setOnInsert: { user: invite.creator, friend: req.user.id, addedAt: now } },
      { upsert: true }
    );

    // Markera invite som använd av denne user
    invite.usedBy.push(new mongoose.Types.ObjectId(req.user.id));
    await invite.save();

    res.json({
      listId: copy._id,
      title: copy.title,
      glosCount: originalGlosor.length
    });
  } catch (err) {
    console.error('Accept list-invite error:', err);
    res.status(500).json({ error: 'Kunde inte acceptera invite-länken.' });
  }
});

module.exports = router;
