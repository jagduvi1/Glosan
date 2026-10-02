const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { isBlockedBetween } = require('../services/blocks');
const { loadReadableList } = require('../middleware/ownership');
const ListInvite = require('../models/ListInvite');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const {
  createListInvite, listListInvites, revokeListInvite, revokeListInviteById, inviteList
} = require('../services/listSharing');

const router = express.Router();

// Skapande är dyrt (DB-write + collision-check) så vi begränsar — en
// person ska inte kunna spamma fram tusentals invites. Per konto (körs efter
// requireAuth), inte per skol-IP.
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `u:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'För många nya invites — vänta lite.' })
});

// POST /api/lists/:id/share-link — alla som har listan (egen eller delad med en)
// Body: { ttlDays: 1|7|30, maxUses: number, befriend?: boolean }
router.post('/lists/:id/share-link', requireAuth, createLimiter, loadReadableList(), async (req, res) => {
  try {
    // Den som går med blir kompis med den som gjort länken bara om hen kryssat
    // i det (av som standard).
    const result = await createListInvite(req.user.id, req.list, {
      ttlDays: req.body?.ttlDays,
      maxUses: req.body?.maxUses,
      befriend: req.body?.befriend === true
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ invite: result.invite });
  } catch (err) {
    console.error('Create list-invite error:', err);
    res.status(500).json({ error: 'Kunde inte skapa invite-länk.' });
  }
});

// GET /api/lists/:id/share-links — listans invites: ägaren ser alla (även
// andras, med `via`), andra bara sina egna
router.get('/lists/:id/share-links', requireAuth, loadReadableList(), async (req, res) => {
  try {
    res.json({ invites: await listListInvites(req.list, req.user.id) });
  } catch (err) {
    console.error('List share-links error:', err);
    res.status(500).json({ error: 'Kunde inte hämta invite-länkar.' });
  }
});

// DELETE /api/lists/:id/share-link/:ref — revokera (mjukt — sätter revokedAt)
// via koden eller länkens id (ägaren ser andras länkar bara med id). Sina
// egna länkar; ägaren alla länkar till listan.
router.delete('/lists/:id/share-link/:ref', requireAuth, loadReadableList(), async (req, res) => {
  try {
    const ref = String(req.params.ref);
    const closed = /^[a-f0-9]{24}$/i.test(ref)
      ? await revokeListInviteById(req.user.id, req.list, ref)
      : await revokeListInvite(req.user.id, req.list, ref);
    if (!closed) {
      return res.status(404).json({ error: 'Invite hittades inte.' });
    }
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
    // Den som gjort länken måste fortfarande ha listan (hen kan ha delat den vidare).
    const [list, creator] = await Promise.all([
      inviteList(invite),
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
      remainingUses: invite.maxUses - invite.usedBy.length,
      befriend: invite.befriend !== false
    });
  } catch (err) {
    console.error('List-invite preview error:', err);
    res.status(500).json({ error: 'Kunde inte ladda invite-länken.' });
  }
});

// POST /api/list-invite/:code/accept — kräver auth
// Kopierar listan + glosor till requestern, och gör dem till kompisar med
// skaparen om länken säger det (befriend).
router.post('/list-invite/:code/accept', requireAuth, async (req, res) => {
  try {
    // En åtkomsttoken lever 15 min efter att kontot raderats — inga spökkompisar.
    if (!(await User.exists({ _id: req.user.id }))) return res.status(401).json({ error: 'Logga in igen.' });
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
    // Blockerad åt något håll — med den som gjort länken eller med listans
    // ägare — eller har den som gjort länken inte listan kvar → länken ser
    // bara ut att inte fungera.
    if (await isBlockedBetween(req.user.id, invite.creator)) {
      return res.status(404).json({ error: 'Den här länken är ogiltig eller har gått ut.' });
    }
    const shared = await inviteList(invite, req.user.id);
    if (!shared) {
      return res.status(404).json({ error: 'Den här länken är ogiltig eller har gått ut.' });
    }
    if (shared.user.toString() === req.user.id) {
      return res.status(400).json({ error: 'Det här är din egen lista.' });
    }
    // Ta en plats atomärt, så två samtidiga klick aldrig spräcker maxUses.
    const uid = new mongoose.Types.ObjectId(req.user.id);
    const claimed = await ListInvite.findOneAndUpdate(
      {
        _id: invite._id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
        usedBy: { $ne: uid },
        $expr: { $lt: [{ $size: '$usedBy' }, '$maxUses'] }
      },
      { $push: { usedBy: uid } }
    );
    if (!claimed) return res.status(404).json({ error: 'Den här länken är ogiltig eller har gått ut.' });

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

    // Lägg till båda som vänner (upsert) — bara om skaparen kryssat i det. Länkar
    // från innan kryssrutan fanns (true, eller helt utan fältet från före
    // v0.1.31) fortsätter som de lovade; länkar som AI:n gjort har alltid false.
    if (invite.befriend !== false) {
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
    }

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
