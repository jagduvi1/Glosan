// Verktyg för glosLISTOR: läsa, skapa (gärna med alla ord i ett anrop — det är
// foto-flödet), ändra, vända riktning och radera.
const { z } = require('zod');
const GlosList = require('../../models/GlosList');
const Glos = require('../../models/Glos');
const Category = require('../../models/Category');
const User = require('../../models/User');
const { registerTool } = require('../registry');
const {
  objectId, ok, fail, resolveList, listSummary, wordSummary, splitDuplicates, validationMessage
} = require('../toolUtil');
const { wordInput, langCode, MAX_WORDS_PER_CALL, MAX_WORDS_PER_LIST } = require('./schemas');

// get_list returnerar hela listan i ett svar; större listor än så här är i
// praktiken ett misstag och skulle bara spräcka modellens kontext.
const GET_LIST_WORD_CAP = MAX_WORDS_PER_LIST;

/** Kontrollera att en kategori tillhör användaren. null = OK/ingen kategori. */
async function checkCategory(userId, categoryId) {
  if (categoryId == null) return null;
  const cat = await Category.findOne({ _id: categoryId, user: userId }).lean();
  return cat ? null : fail('not_found', 'No such category. Use list_categories for valid category ids, or create_category first.');
}

function toGlosDoc(listId, w) {
  return {
    list: listId,
    source: w.source,
    target: w.target,
    notes: w.notes || '',
    exampleSentence: w.example_sentence || '',
    extra: w.extra === true
  };
}

registerTool({
  name: 'list_lists',
  title: 'List my vocabulary lists',
  description:
    'Lists the user\'s vocabulary lists (glosor): their own lists plus lists friends have shared with them, with languages, word count, category and best quiz score. ' +
    'Call this first when you need a list_id, or when the user asks what lists they have.',
  scope: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    include_shared: z.boolean().optional().describe('Include lists friends shared with the user (default true)')
  },
  handler: async (args, ctx) => {
    const userId = ctx.user.id;
    const [owned, shared] = await Promise.all([
      GlosList.find({ user: userId }).sort({ updatedAt: -1 }).lean(),
      args.include_shared === false
        ? []
        : GlosList.find({ sharedWith: userId }).sort({ updatedAt: -1 }).populate('user', 'username').lean()
    ]);
    const all = [...owned, ...shared];
    const counts = all.length
      ? await Glos.aggregate([
          { $match: { list: { $in: all.map((l) => l._id) } } },
          { $group: { _id: '$list', n: { $sum: 1 } } }
        ])
      : [];
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    const data = [
      ...owned.map((l) => listSummary(l, { word_count: countBy.get(String(l._id)) || 0, is_owner: true })),
      ...shared.map((l) => listSummary(l, {
        word_count: countBy.get(String(l._id)) || 0,
        is_owner: false,
        shared_by: l.user?.username || null,
        share_mode: l.shareMode
      }))
    ];
    return ok(`${owned.length} own list(s), ${shared.length} shared with the user`, data);
  }
});

registerTool({
  name: 'get_list',
  title: 'Get one list with its words',
  description:
    'Returns one vocabulary list with all its words (word_id, source, target, notes, example sentence, extra flag) and per-word practice stats (correct/wrong counts). ' +
    'Use it before editing words (you need word_ids), to check what is already on a list, or to see which words the user struggles with.',
  scope: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    list_id: objectId.describe('List id from list_lists'),
    include_stats: z.boolean().optional().describe('Include per-word practice stats (default true)')
  },
  handler: async (args, ctx) => {
    const access = await resolveList(ctx.user.id, args.list_id, 'read');
    if (access.error) return access.error;
    const { list, isOwner } = access;
    const words = await Glos.find({ list: list._id }).sort({ createdAt: 1 }).limit(GET_LIST_WORD_CAP + 1).lean();
    const truncated = words.length > GET_LIST_WORD_CAP;
    let sharedBy = null;
    if (!isOwner) {
      const owner = await User.findById(list.user, 'username').lean();
      sharedBy = owner?.username || null;
    }
    const data = {
      ...listSummary(list, {
        is_owner: isOwner,
        ...(isOwner ? {} : { shared_by: sharedBy, share_mode: list.shareMode })
      }),
      word_count: truncated ? `${GET_LIST_WORD_CAP}+` : words.length,
      words: words.slice(0, GET_LIST_WORD_CAP).map((g) => wordSummary(g, { withStats: args.include_stats !== false }))
    };
    return ok(`"${list.title}" — ${data.words.length} word(s)`, data, truncated ? { warnings: [`Only the first ${GET_LIST_WORD_CAP} words are shown.`] } : {});
  }
});

registerTool({
  name: 'create_list',
  title: 'Create a vocabulary list',
  description:
    'Creates a new vocabulary list for the user, optionally with all its words in the same call (up to ' + MAX_WORDS_PER_CALL + '). ' +
    'This is the tool for "make a list from this photo/text": read the words yourself, show them to the user, then create the list with every pair in `words`. ' +
    'source_lang is the learner\'s own language (usually Swedish, "sv") and target_lang the language being studied; each word\'s `source` is in source_lang and `target` in target_lang. ' +
    'Returns the list_id and a url the user can open to practise.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    title: z.string().trim().min(1).max(100).describe('List title, e.g. "Engelska v. 38 — Food"'),
    description: z.string().trim().max(500).optional().describe('Optional description, e.g. the chapter or test date'),
    source_lang: langCode.describe('ISO 639-1 code of the learner\'s own language — usually "sv"'),
    target_lang: langCode.describe('ISO 639-1 code of the language being studied, e.g. "en", "de", "fr", "es"'),
    quiz_reversed: z.boolean().optional().describe('Practice direction. Omit to use the app default (true = the quiz shows the target_lang word and asks for the source_lang word; false = shows source_lang, asks for target_lang). The user can flip it in the app anytime.'),
    category_id: objectId.optional().describe('Optional category id from list_categories'),
    words: z.array(wordInput).max(MAX_WORDS_PER_CALL).optional().describe('The word pairs to put on the list')
  },
  handler: async (args, ctx) => {
    const userId = ctx.user.id;
    const catError = await checkCategory(userId, args.category_id);
    if (catError) return catError;
    if (await GlosList.countDocuments({ user: userId }) >= GlosList.MAX_LISTS_PER_USER) {
      return fail('conflict', `The user already has ${GlosList.MAX_LISTS_PER_USER} lists — add to an existing one (add_words) or ask them to delete old lists.`);
    }

    const { fresh, duplicates } = splitDuplicates(args.words || [], []);
    let list;
    try {
      list = await GlosList.create({
        user: userId,
        title: args.title,
        description: args.description || '',
        sourceLang: args.source_lang,
        targetLang: args.target_lang,
        ...(typeof args.quiz_reversed === 'boolean' ? { quizReversed: args.quiz_reversed } : {}),
        categoryId: args.category_id || null
      });
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }

    try {
      if (fresh.length) await Glos.insertMany(fresh.map((w) => toGlosDoc(list._id, w)));
    } catch (err) {
      // Ingen halvfärdig lista: städa bort den och låt modellen rätta indata.
      await Glos.deleteMany({ list: list._id }).catch(() => {});
      await list.deleteOne().catch(() => {});
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }

    return ok(`Created list "${list.title}" with ${fresh.length} word(s)`, {
      ...listSummary(list.toObject(), { is_owner: true }),
      word_count: fresh.length,
      ...(duplicates.length ? { skipped_duplicates: duplicates.map((w) => ({ source: w.source, target: w.target })) } : {})
    });
  }
});

registerTool({
  name: 'update_list',
  title: 'Edit a list\'s details',
  description:
    'Changes a list\'s title, description, languages, practice direction (quiz_reversed) or category. Only the list owner can do this. ' +
    'To flip which language each word is stored in, use swap_list_direction instead of changing the language codes.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    list_id: objectId.describe('List id from list_lists'),
    title: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    source_lang: langCode.optional(),
    target_lang: langCode.optional(),
    quiz_reversed: z.boolean().optional().describe('true = the quiz shows the target_lang word and asks for the source_lang word; false = the opposite'),
    category_id: objectId.nullable().optional().describe('Category id from list_categories, or null to remove the category')
  },
  handler: async (args, ctx) => {
    const access = await resolveList(ctx.user.id, args.list_id, 'owner');
    if (access.error) return access.error;
    const { list } = access;
    if (args.category_id !== undefined) {
      const catError = await checkCategory(ctx.user.id, args.category_id);
      if (catError) return catError;
    }
    const changed = [];
    const set = (field, value, label) => {
      if (value === undefined) return;
      list[field] = value;
      changed.push(label);
    };
    set('title', args.title, 'title');
    set('description', args.description, 'description');
    set('sourceLang', args.source_lang, 'source_lang');
    set('targetLang', args.target_lang, 'target_lang');
    set('quizReversed', args.quiz_reversed, 'quiz_reversed');
    set('categoryId', args.category_id === undefined ? undefined : (args.category_id || null), 'category_id');
    if (!changed.length) return fail('invalid_input', 'Nothing to change — pass at least one field to update.');
    try {
      await list.save();
    } catch (err) {
      if (err.name === 'ValidationError') return fail('invalid_input', validationMessage(err));
      throw err;
    }
    return ok(`Updated ${changed.join(', ')} on "${list.title}"`, listSummary(list.toObject(), { is_owner: true }));
  }
});

registerTool({
  name: 'swap_list_direction',
  title: 'Swap a list\'s languages',
  description:
    'Flips a list\'s source and target languages AND swaps source/target on every word — for a list that was created the wrong way round (e.g. English stored as the source). ' +
    'The practice direction is flipped too, so the quiz experience stays the same. Only the owner can do this. Calling it twice restores the original.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  inputSchema: { list_id: objectId.describe('List id from list_lists') },
  handler: async (args, ctx) => {
    const access = await resolveList(ctx.user.id, args.list_id, 'owner');
    if (access.error) return access.error;
    const { list } = access;
    const { sourceLang, targetLang } = list;
    list.sourceLang = targetLang;
    list.targetLang = sourceLang;
    list.quizReversed = !(list.quizReversed ?? true);
    await list.save();
    const words = await Glos.find({ list: list._id }, '_id source target').lean();
    if (words.length) {
      await Glos.bulkWrite(words.map((g) => ({
        updateOne: { filter: { _id: g._id }, update: { $set: { source: g.target, target: g.source } } }
      })));
    }
    return ok(`Swapped "${list.title}" to ${list.sourceLang} → ${list.targetLang} (${words.length} word(s))`, listSummary(list.toObject(), { is_owner: true }));
  }
});

registerTool({
  name: 'delete_list',
  title: 'Delete a list',
  description:
    'Permanently deletes one of the user\'s own lists together with all its words and practice stats. This CANNOT be undone. ' +
    'Always confirm with the user first, naming the exact list title and word count.',
  scope: 'write',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: { list_id: objectId.describe('List id from list_lists') },
  handler: async (args, ctx) => {
    const access = await resolveList(ctx.user.id, args.list_id, 'owner');
    if (access.error) return access.error;
    const { list } = access;
    const { deletedCount } = await Glos.deleteMany({ list: list._id });
    await list.deleteOne();
    return ok(`Deleted list "${list.title}" and its ${deletedCount} word(s)`, { list_id: String(list._id), title: list.title, words_deleted: deletedCount });
  }
});

module.exports = { checkCategory, toGlosDoc };
