// Om Glosan och om användaren själv.
const User = require('../../models/User');
const GlosList = require('../../models/GlosList');
const Glos = require('../../models/Glos');
const { effectivePlan } = require('../../config/plans');
const { registerTool } = require('../registry');
const { ok } = require('../toolUtil');
const { issuer } = require('../../services/mcpOAuth');
const version = require('../../version');

// Samma kurva som routes/me.js: nivå N kräver (N-1)² × 100 XP.
const levelFromXp = (xp) => Math.floor(Math.sqrt((xp || 0) / 100)) + 1;

registerTool({
  name: 'get_source_info',
  title: 'About Glosan',
  description:
    'What Glosan is, which instance this is, and where its source code lives. Call when the user asks what Glosan is, whether it is open source, or where to find the code.',
  scope: 'public',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {},
  handler: async () => ok('Glosan — open-source vocabulary trainer', {
    name: 'Glosan',
    what: 'A self-hostable vocabulary (glosor) trainer: users keep their own word lists and practise them with quizzes, flashcards and games, alone or against friends.',
    app_url: issuer(),
    source_code: 'https://github.com/jagduvi1/Glosan',
    license: 'AGPL-3.0-or-later',
    server_version: version
  })
});

registerTool({
  name: 'get_profile',
  title: 'My Glosan profile',
  description:
    'The user\'s username, level, XP, practice streak and totals (lists, words, correct/wrong answers). Use for "how am I doing?" or to greet the user by name.',
  scope: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {},
  handler: async (_args, ctx) => {
    const user = await User.findById(ctx.user.id).lean();
    if (!user) return ok('Profile not found', null);
    const lists = await GlosList.find({ user: user._id }, '_id').lean();
    const [agg] = lists.length
      ? await Glos.aggregate([
          { $match: { list: { $in: lists.map((l) => l._id) } } },
          {
            $group: {
              _id: null,
              words: { $sum: 1 },
              correct: { $sum: { $ifNull: ['$stats.correct', 0] } },
              wrong: { $sum: { $ifNull: ['$stats.wrong', 0] } }
            }
          }
        ])
      : [];
    const plan = effectivePlan(user);
    return ok(`${user.username} — level ${levelFromXp(user.xp)}`, {
      username: user.username,
      level: levelFromXp(user.xp),
      xp: user.xp || 0,
      streak: { current: user.streak?.current ?? 0, longest: user.streak?.longest ?? 0 },
      quizzes_completed: user.quizzesCompleted ?? 0,
      total_lists: lists.length,
      total_words: agg?.words || 0,
      total_correct_answers: agg?.correct || 0,
      total_wrong_answers: agg?.wrong || 0,
      plan: plan.label,
      member_since: user.createdAt || null
    });
  }
});
