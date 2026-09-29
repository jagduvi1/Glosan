// Kategorier = användarens egna mappar för listor ("Engelska", "Tyska åk 8" …).
const mongoose = require('mongoose');
const { z } = require('zod');
const Category = require('../../models/Category');
const GlosList = require('../../models/GlosList');
const { registerTool } = require('../registry');
const { ok, fail, validationMessage } = require('../toolUtil');

const COLORS = ['coral', 'leaf', 'sky', 'mustard', 'plum', 'berry'];

registerTool({
  name: 'list_categories',
  title: 'List my categories',
  description:
    'Lists the user\'s categories (folders that group lists, e.g. "Engelska", "Tyska") with how many lists each holds. ' +
    'Use it to pick a category_id for create_list / update_list.',
  scope: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {},
  handler: async (_args, ctx) => {
    const cats = await Category.find({ user: ctx.user.id }).sort({ name: 1 }).lean();
    const counts = cats.length
      ? await GlosList.aggregate([
          { $match: { user: new mongoose.Types.ObjectId(ctx.user.id), categoryId: { $in: cats.map((c) => c._id) } } },
          { $group: { _id: '$categoryId', n: { $sum: 1 } } }
        ])
      : [];
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    return ok(`${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`, cats.map((c) => ({
      category_id: String(c._id),
      name: c.name,
      color: c.color || null,
      list_count: countBy.get(String(c._id)) || 0
    })));
  }
});

registerTool({
  name: 'create_category',
  title: 'Create a category',
  description:
    'Creates a category (a folder for lists). Check list_categories first so you don\'t create a duplicate of one that already exists.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    name: z.string().trim().min(1).max(60).describe('Category name, e.g. "Engelska"'),
    color: z.enum(COLORS).optional().describe('Optional colour dot shown in the app')
  },
  handler: async (args, ctx) => {
    const existing = await Category.findOne({ user: ctx.user.id, name: args.name }).lean();
    if (existing) {
      return fail('conflict', `A category named "${args.name}" already exists (category_id ${existing._id}). Use that one.`);
    }
    try {
      const cat = await Category.create({ user: ctx.user.id, name: args.name, color: args.color || null });
      return ok(`Created category "${cat.name}"`, { category_id: String(cat._id), name: cat.name, color: cat.color || null });
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }
  }
});
