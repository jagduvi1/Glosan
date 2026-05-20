const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const { loadOwnedCategory } = require('../middleware/ownership');
const Category = require('../models/Category');
const GlosList = require('../models/GlosList');

const router = express.Router();

router.use(requireAuth);

const ALLOWED_COLORS = ['coral', 'leaf', 'sky', 'mustard', 'plum', 'berry'];

router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({ user: req.user.id }).sort({ name: 1 });
    // Include list counts so the UI can show "N listor" next to each category.
    const counts = await GlosList.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(req.user.id), categoryId: { $ne: null } } },
      { $group: { _id: '$categoryId', count: { $sum: 1 } } }
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
    const enriched = categories.map((c) => ({
      ...c.toObject(),
      listCount: countMap[String(c._id)] || 0
    }));
    res.json({ categories: enriched });
  } catch (error) {
    console.error('Category index error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (color && !ALLOWED_COLORS.includes(color)) {
      return res.status(400).json({ error: `color must be one of: ${ALLOWED_COLORS.join(', ')}` });
    }
    const category = await Category.create({
      user: req.user.id,
      name: name.trim(),
      color: color || null
    });
    res.status(201).json({ category });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('Category create error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

router.put('/:id', loadOwnedCategory, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      req.category.name = name.trim();
    }
    if (color !== undefined) {
      if (color !== null && !ALLOWED_COLORS.includes(color)) {
        return res.status(400).json({ error: `color must be one of: ${ALLOWED_COLORS.join(', ')} or null` });
      }
      req.category.color = color;
    }
    await req.category.save();
    res.json({ category: req.category });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map(e => e.message).join(', ') });
    }
    console.error('Category update error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

router.delete('/:id', loadOwnedCategory, async (req, res) => {
  try {
    // Clear categoryId from any lists that were in this category, then delete.
    const cleared = await GlosList.updateMany(
      { user: req.user.id, categoryId: req.category._id },
      { $set: { categoryId: null } }
    );
    await req.category.deleteOne();
    res.json({ message: 'Category deleted', listsCleared: cleared.modifiedCount || 0 });
  } catch (error) {
    console.error('Category delete error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
