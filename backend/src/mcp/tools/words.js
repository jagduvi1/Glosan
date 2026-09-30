// Verktyg för enskilda glosor: lägga till (i bulk), rätta, radera och hitta
// de ord användaren har svårast för.
const mongoose = require('mongoose');
const { z } = require('zod');
const GlosList = require('../../models/GlosList');
const Glos = require('../../models/Glos');
const { registerTool } = require('../registry');
const {
  objectId, ok, fail, MSG_WORD_NOT_FOUND, resolveList, wordSummary, splitDuplicates, validationMessage, listUrl
} = require('../toolUtil');
const { wordInput, MAX_WORDS_PER_CALL, MAX_WORDS_PER_LIST } = require('./schemas');
const { withUserLock } = require('../userLock');
const { toGlosDoc } = require('./lists');

registerTool({
  name: 'add_words',
  title: 'Add words to a list',
  description:
    'Adds word pairs to an existing list (up to ' + MAX_WORDS_PER_CALL + ' per call). Pairs already on the list (same source + target, case-insensitive) are skipped and reported, so re-sending a photo\'s words is safe. ' +
    'Each word\'s `source` must be in the list\'s source_lang and `target` in its target_lang — check them with get_list or list_lists first. ' +
    'Works on the user\'s own lists and on lists a friend shared with edit rights.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    list_id: objectId.describe('List id from list_lists'),
    words: z.array(wordInput).min(1).max(MAX_WORDS_PER_CALL).describe('The word pairs to add')
  },
  handler: async (args, ctx) => withUserLock(ctx.user.id, async () => {
    const access = await resolveList(ctx.user.id, args.list_id, 'edit');
    if (access.error) return access.error;
    const { list, isOwner } = access;
    const existing = await Glos.find({ list: list._id }, 'source target').lean();
    const { fresh, duplicates } = splitDuplicates(args.words, existing);
    if (existing.length + fresh.length > MAX_WORDS_PER_LIST) {
      return fail('invalid_input', `A list can hold at most ${MAX_WORDS_PER_LIST} words and this one already has ${existing.length}. Create a new list for the rest.`);
    }
    // Bara ägaren bestämmer vad som är "extra" (samma regel som REST-routen).
    const docs = fresh.map((w) => toGlosDoc(list._id, isOwner ? w : { ...w, extra: false }));
    let inserted = [];
    try {
      if (docs.length) inserted = await Glos.insertMany(docs);
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }
    // Taket igen efter insättningen: någon annan med redigeringsrätt kan ha
    // lagt till samtidigt (låset gäller en användare). Över taket → ta bort våra.
    if (inserted.length && (await Glos.countDocuments({ list: list._id })) > MAX_WORDS_PER_LIST) {
      await Glos.deleteMany({ _id: { $in: inserted.map((g) => g._id) } });
      return fail('invalid_input', `The list reached its limit of ${MAX_WORDS_PER_LIST} words while adding — nothing was added. Create a new list for the rest.`);
    }
    return ok(`Added ${inserted.length} word(s) to the list${duplicates.length ? `, skipped ${duplicates.length} already on it` : ''}`, {
      list_id: String(list._id),
      url: listUrl(list._id),
      added: inserted.map((g) => wordSummary(g, { withStats: false })),
      ...(duplicates.length ? { skipped_duplicates: duplicates.map((w) => ({ source: w.source, target: w.target })) } : {}),
      word_count: existing.length + inserted.length
    });
  })
});

registerTool({
  name: 'update_word',
  title: 'Correct a word',
  description:
    'Changes one word on a list: fix a spelling, change the translation, or set notes / example sentence / the extra flag. Only the fields you pass change. ' +
    'Get word_ids from get_list.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    word_id: objectId.describe('Word id from get_list'),
    source: z.string().trim().min(1).max(200).optional(),
    target: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(500).optional().describe('Pass an empty string to clear'),
    example_sentence: z.string().trim().max(500).optional().describe('Pass an empty string to clear'),
    extra: z.boolean().optional().describe('true = bonus word, not homework (owner only)')
  },
  handler: async (args, ctx) => {
    if (!mongoose.Types.ObjectId.isValid(args.word_id)) return fail('not_found', MSG_WORD_NOT_FOUND);
    const glos = await Glos.findById(args.word_id);
    if (!glos) return fail('not_found', MSG_WORD_NOT_FOUND);
    const access = await resolveList(ctx.user.id, glos.list, 'edit');
    // En annans lista ser ut exakt som ett ord som inte finns (inget orakel).
    if (access.error) return access.code === 'not_found' ? fail('not_found', MSG_WORD_NOT_FOUND) : access.error;
    const warnings = [];
    const changed = [];
    for (const [arg, field] of [['source', 'source'], ['target', 'target'], ['notes', 'notes'], ['example_sentence', 'exampleSentence']]) {
      if (args[arg] !== undefined) {
        glos[field] = args[arg];
        changed.push(arg);
      }
    }
    if (typeof args.extra === 'boolean') {
      if (access.isOwner) {
        glos.extra = args.extra;
        changed.push('extra');
      } else {
        warnings.push('The extra flag was not changed — only the list owner decides what is homework.');
      }
    }
    if (!changed.length) {
      return warnings.length ? fail('forbidden', warnings[0]) : fail('invalid_input', 'Nothing to change — pass at least one field to update.');
    }
    try {
      await glos.save();
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }
    return ok(`Updated ${changed.join(', ')} on "${glos.source} — ${glos.target}"`, wordSummary(glos), warnings.length ? { warnings } : {});
  }
});

registerTool({
  name: 'delete_words',
  title: 'Delete words from a list',
  description:
    'Permanently removes words from one list (with their practice stats). Cannot be undone — confirm with the user first, naming the words. ' +
    'Get word_ids from get_list.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    list_id: objectId.describe('The list the words are on'),
    word_ids: z.array(objectId).min(1).max(MAX_WORDS_PER_CALL).describe('Word ids from get_list')
  },
  handler: async (args, ctx) => {
    const access = await resolveList(ctx.user.id, args.list_id, 'edit');
    if (access.error) return access.error;
    const { list } = access;
    const ids = [...new Set(args.word_ids.map(String))];
    const found = await Glos.find({ _id: { $in: ids }, list: list._id }, 'source target').lean();
    const foundIds = new Set(found.map((g) => String(g._id)));
    await Glos.deleteMany({ _id: { $in: [...foundIds] }, list: list._id });
    const missing = ids.filter((id) => !foundIds.has(id));
    return ok(`Deleted ${found.length} word(s) from the list`, {
      list_id: String(list._id),
      deleted: found.map((g) => ({ word_id: String(g._id), source: g.source, target: g.target })),
      ...(missing.length ? { not_on_list: missing } : {})
    });
  }
});

registerTool({
  name: 'list_hard_words',
  title: 'Find the words I struggle with',
  description:
    'Returns the words the user has answered wrong most often in practice, across all their own lists (or one list), hardest first — with list title, correct/wrong counts and last practice time. ' +
    'Use for "which words do I keep getting wrong?", to coach the user in chat, or to build a focused practice list with create_list.',
  scope: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    list_id: objectId.optional().describe('Limit to one of the user\'s own lists'),
    limit: z.number().int().min(1).max(100).optional().describe('How many words to return (default 25)')
  },
  handler: async (args, ctx) => {
    // Per-ord-statistik räknas bara för listans ägare (se routes/glosor.js),
    // så bara egna listor ger meningsfulla siffror.
    let lists;
    if (args.list_id) {
      const access = await resolveList(ctx.user.id, args.list_id, 'owner');
      if (access.error) return access.error;
      lists = [access.list];
    } else {
      lists = await GlosList.find({ user: ctx.user.id }, 'title').lean();
    }
    if (!lists.length) return ok('The user has no lists yet', []);
    const titleBy = new Map(lists.map((l) => [String(l._id), l.title]));
    const rows = await Glos.aggregate([
      { $match: { list: { $in: lists.map((l) => l._id) }, 'stats.wrong': { $gt: 0 } } },
      { $addFields: { net: { $subtract: ['$stats.wrong', { $ifNull: ['$stats.correct', 0] }] } } },
      { $sort: { net: -1, 'stats.wrong': -1, _id: 1 } },
      { $limit: args.limit || 25 }
    ]);
    const data = rows.map((g) => ({
      ...wordSummary(g),
      list_id: String(g.list),
      list_title: titleBy.get(String(g.list)) || null
    }));
    return ok(data.length ? `${data.length} word(s) the user has answered wrong` : 'No wrong answers recorded yet — practise first', data);
  }
});
