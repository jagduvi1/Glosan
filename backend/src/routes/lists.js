const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const { loadOwnedList, loadReadableList } = require('../middleware/ownership');
const GlosList = require('../models/GlosList');
const Glos = require('../models/Glos');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const QuizRunEvent = require('../models/QuizRunEvent');

const router = express.Router();

router.use(requireAuth);

// GET /api/lists — egna listor + listor någon har delat med mig. Mottagar-
// listor markeras med `isShared: true` + ägarens username så frontend kan
// gruppera och visa "delad av X".
router.get('/', async (req, res) => {
  try {
    const owned = await GlosList.find({ user: req.user.id }).sort({ updatedAt: -1 }).lean();
    const shared = await GlosList.find({ sharedWith: req.user.id })
      .sort({ updatedAt: -1 })
      .populate('user', 'username avatar')
      .lean();
    res.json({
      lists: owned,
      sharedLists: shared.map((l) => ({
        ...l,
        isShared: true,
        sharedBy: l.user ? { username: l.user.username, avatar: l.user.avatar } : null
      }))
    });
  } catch (error) {
    console.error('List index error:', error);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, description, sourceLang, targetLang, categoryId } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const list = await GlosList.create({
      user: req.user.id,
      title,
      description,
      sourceLang,
      targetLang,
      categoryId: categoryId || null
    });
    res.status(201).json({ list });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('List create error:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

router.get('/:id', loadReadableList(), async (req, res) => {
  try {
    const glosor = await Glos.find({ list: req.list._id }).sort({ createdAt: 1 });
    // För mottagare: berika svaret med ägar-info och flagga icke-ägar-läge.
    let sharedBy = null;
    if (!req.listIsOwner) {
      const owner = await User.findById(req.list.user, 'username avatar').lean();
      if (owner) sharedBy = { username: owner.username, avatar: owner.avatar };
    }
    res.json({
      list: req.list,
      glosor,
      isOwner: req.listIsOwner,
      sharedBy
    });
  } catch (error) {
    console.error('List get error:', error);
    res.status(500).json({ error: 'Failed to fetch list' });
  }
});

router.put('/:id', loadOwnedList(), async (req, res) => {
  try {
    const { title, description, sourceLang, targetLang, quizReversed, categoryId } = req.body;
    if (title !== undefined) req.list.title = title;
    if (description !== undefined) req.list.description = description;
    if (sourceLang !== undefined) req.list.sourceLang = sourceLang;
    if (targetLang !== undefined) req.list.targetLang = targetLang;
    if (typeof quizReversed === 'boolean') req.list.quizReversed = quizReversed;
    if (categoryId !== undefined) req.list.categoryId = categoryId || null;
    await req.list.save();

    res.json({ list: req.list });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('List update error:', error);
    res.status(500).json({ error: 'Failed to update list' });
  }
});

// POST /api/lists/:id/score — submit a quiz result; updates bestScore only if
// the new correct/total ratio is strictly higher than the existing record.
router.post('/:id/score', loadOwnedList(), async (req, res) => {
  const correct = Number(req.body.correct);
  const total = Number(req.body.total);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
    return res.status(400).json({ error: 'correct and total must be valid numbers with 0 <= correct <= total and total > 0' });
  }
  try {
    const newRatio = correct / total;
    const oldTotal = req.list.bestScore?.total || 0;
    const oldRatio = oldTotal > 0 ? req.list.bestScore.correct / oldTotal : 0;
    const wasNewBest = newRatio > oldRatio;

    if (wasNewBest) {
      req.list.bestScore = { correct, total, achievedAt: new Date() };
      await req.list.save();
    }

    res.json({ list: req.list, wasNewBest });
  } catch (error) {
    console.error('List score submit error:', error);
    res.status(500).json({ error: 'Failed to submit score' });
  }
});

// POST /api/lists/:id/swap-direction — flip the list's source/target languages,
// swap the source/target on every glos in the list, and flip quizReversed so
// the quiz experience stays identical. Useful when a list was created with the
// "wrong" orientation and the user wants the add-glos form swapped.
router.post('/:id/swap-direction', loadOwnedList(), async (req, res) => {
  try {
    const { sourceLang, targetLang } = req.list;
    req.list.sourceLang = targetLang;
    req.list.targetLang = sourceLang;
    req.list.quizReversed = !req.list.quizReversed;
    await req.list.save();

    const glosor = await Glos.find({ list: req.list._id }, '_id source target').lean();
    if (glosor.length > 0) {
      const ops = glosor.map((g) => ({
        updateOne: {
          filter: { _id: g._id },
          update: { $set: { source: g.target, target: g.source } }
        }
      }));
      await Glos.bulkWrite(ops);
    }

    res.json({ list: req.list, glosorSwapped: glosor.length });
  } catch (error) {
    console.error('List swap-direction error:', error);
    res.status(500).json({ error: 'Failed to swap direction' });
  }
});

router.delete('/:id', loadOwnedList(), async (req, res) => {
  try {
    await Glos.deleteMany({ list: req.list._id });
    await req.list.deleteOne();
    res.json({ message: 'List deleted' });
  } catch (error) {
    console.error('List delete error:', error);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

// GET /api/lists/:id/shares — vilka kompisar har access till listan?
// Bara ägaren får se delningar.
router.get('/:id/shares', loadOwnedList(), async (req, res) => {
  try {
    const users = await User.find({ _id: { $in: req.list.sharedWith } }, 'username avatar friendCode').lean();
    res.json({ shares: users });
  } catch (error) {
    console.error('List shares get error:', error);
    res.status(500).json({ error: 'Failed to fetch shares' });
  }
});

// POST /api/lists/:id/share — body { friendIds: [string], mode?: 'read'|'edit' }.
// Lägger till user-ID:n i sharedWith. Varje ID måste vara en bekräftad kompis
// (finns i Friendship-tabellen). Om mode anges uppdateras list.shareMode för
// alla nuvarande + nya mottagare (en mode per lista).
router.post('/:id/share', loadOwnedList(), async (req, res) => {
  const { friendIds, mode } = req.body;
  if (!Array.isArray(friendIds) || friendIds.length === 0) {
    return res.status(400).json({ error: 'friendIds måste vara en lista med minst ett ID' });
  }
  if (mode !== undefined && mode !== 'read' && mode !== 'edit') {
    return res.status(400).json({ error: 'mode måste vara "read" eller "edit"' });
  }
  const validIds = friendIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    return res.status(400).json({ error: 'Inga giltiga ID:n' });
  }
  try {
    const friendships = await Friendship.find({
      user: req.user.id,
      friend: { $in: validIds }
    }, 'friend').lean();
    const confirmedFriends = new Set(friendships.map((f) => f.friend.toString()));
    const toAdd = validIds.filter((id) => confirmedFriends.has(id));
    if (toAdd.length === 0) {
      return res.status(400).json({ error: 'Du måste vara kompis för att kunna dela listan.' });
    }

    const before = new Set(req.list.sharedWith.map(String));
    for (const id of toAdd) before.add(id);
    req.list.sharedWith = Array.from(before);
    if (mode) req.list.shareMode = mode;
    await req.list.save();

    const users = await User.find({ _id: { $in: req.list.sharedWith } }, 'username avatar friendCode').lean();
    res.json({ shares: users, list: req.list });
  } catch (error) {
    console.error('List share error:', error);
    res.status(500).json({ error: 'Failed to share list' });
  }
});

// PATCH /api/lists/:id/share-mode — flippa läget mellan read och edit utan
// att ändra vilka som har access.
router.patch('/:id/share-mode', loadOwnedList(), async (req, res) => {
  const { mode } = req.body;
  if (mode !== 'read' && mode !== 'edit') {
    return res.status(400).json({ error: 'mode måste vara "read" eller "edit"' });
  }
  try {
    req.list.shareMode = mode;
    await req.list.save();
    res.json({ list: req.list });
  } catch (error) {
    console.error('List share-mode error:', error);
    res.status(500).json({ error: 'Failed to update share mode' });
  }
});

// POST /api/lists/:id/copy — duplicera en lista (inkl. alla glosor) till
// req.user. Funkar för både egna och delade listor. Den nya kopian äger
// du själv, kan redigera fritt, inga delningar följer med.
router.post('/:id/copy', loadReadableList(), async (req, res) => {
  try {
    const sourceList = req.list;
    const newList = await GlosList.create({
      user: req.user.id,
      title: req.body.title || `${sourceList.title} (kopia)`,
      description: sourceList.description,
      sourceLang: sourceList.sourceLang,
      targetLang: sourceList.targetLang,
      quizReversed: sourceList.quizReversed
      // categoryId hoppas — kopian börjar utan kategori; mottagaren placerar
      // den i sin egen kategori-struktur.
    });

    const sourceGlosor = await Glos.find({ list: sourceList._id }).lean();
    if (sourceGlosor.length > 0) {
      await Glos.insertMany(sourceGlosor.map((g) => ({
        list: newList._id,
        source: g.source,
        target: g.target,
        notes: g.notes,
        exampleSentence: g.exampleSentence,
        extra: g.extra
        // stats hoppas — kopian börjar med fresh mastery
      })));
    }

    res.status(201).json({ list: newList, copiedGlosor: sourceGlosor.length });
  } catch (error) {
    console.error('List copy error:', error);
    res.status(500).json({ error: 'Failed to copy list' });
  }
});

// DELETE /api/lists/:id/share/:userId — ta bort en enskild mottagare.
// Endast ägaren får anropa det.
router.delete('/:id/share/:userId', loadOwnedList(), async (req, res) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  try {
    req.list.sharedWith = req.list.sharedWith.filter((id) => id.toString() !== userId);
    await req.list.save();
    res.json({ list: req.list });
  } catch (error) {
    console.error('List unshare error:', error);
    res.status(500).json({ error: 'Failed to unshare list' });
  }
});

// POST /api/lists/:id/leave — mottagaren tar bort sig själv från en delad
// lista. Useful om man vill rensa "delade med dig"-sektionen utan att be
// ägaren göra det.
router.post('/:id/leave', loadReadableList(), async (req, res) => {
  if (req.listIsOwner) {
    return res.status(400).json({ error: 'Du äger den här listan — använd radera istället.' });
  }
  try {
    req.list.sharedWith = req.list.sharedWith.filter((id) => id.toString() !== req.user.id);
    await req.list.save();
    res.json({ message: 'Du har lämnat listan' });
  } catch (error) {
    console.error('List leave error:', error);
    res.status(500).json({ error: 'Failed to leave list' });
  }
});

// GET /api/lists/:id/weekly-records — bästa quiz-rond denna vecka per
// deltagare (ägare + alla i sharedWith). Bara users som faktiskt gjort
// minst en rond denna vecka tas med.
router.get('/:id/weekly-records', loadReadableList(), async (req, res) => {
  try {
    // Vecka börjar måndag (svensk konvention).
    const now = new Date();
    const day = now.getDay(); // 0 = söndag
    const offset = day === 0 ? 6 : day - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - offset);
    weekStart.setHours(0, 0, 0, 0);

    const participants = [req.list.user, ...(req.list.sharedWith || [])];
    // Aggregera bästa ratio per deltagare. Tie-break: senast.
    const agg = await QuizRunEvent.aggregate([
      { $match: { list: req.list._id, user: { $in: participants }, createdAt: { $gte: weekStart } } },
      {
        $sort: { ratio: -1, correct: -1, createdAt: -1 }
      },
      {
        $group: {
          _id: '$user',
          bestCorrect: { $first: '$correct' },
          bestTotal: { $first: '$total' },
          bestRatio: { $first: '$ratio' },
          runs: { $sum: 1 },
          lastRun: { $first: '$createdAt' }
        }
      }
    ]);
    const byUser = new Map(agg.map((r) => [r._id.toString(), r]));
    const users = await User.find({ _id: { $in: participants } }, 'username avatar').lean();
    const rows = users
      .map((u) => {
        const r = byUser.get(u._id.toString());
        if (!r) return null;
        return {
          _id: u._id,
          username: u.username,
          avatar: u.avatar || { kind: 'initial', value: '' },
          isMe: u._id.toString() === req.user.id,
          isOwner: u._id.toString() === req.list.user.toString(),
          bestCorrect: r.bestCorrect,
          bestTotal: r.bestTotal,
          bestRatio: r.bestRatio,
          runs: r.runs,
          lastRun: r.lastRun
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.bestRatio !== a.bestRatio) return b.bestRatio - a.bestRatio;
        if (b.bestCorrect !== a.bestCorrect) return b.bestCorrect - a.bestCorrect;
        return new Date(a.lastRun) - new Date(b.lastRun);
      });
    res.json({ weekStart, records: rows });
  } catch (error) {
    console.error('Weekly records error:', error);
    res.status(500).json({ error: 'Failed to fetch weekly records' });
  }
});

module.exports = router;
