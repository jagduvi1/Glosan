// Gemensamma hjälpare för MCP-verktygen: svarskuvert, felkoder och
// åtkomstkontrollerna (tjänste-motsvarigheten till middleware/ownership.js —
// samma semantik, utan req/res).
const mongoose = require('mongoose');
const { z } = require('zod');
const GlosList = require('../models/GlosList');
const { issuer } = require('../services/mcpOAuth');

/** zod-form för Mongo-id:n i verktygens input. */
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a 24-hex id');

// Samma formulering för "finns inte" och "ingen åtkomst" (inget orakel för om
// någon annans lista finns), plus återhämtningstipset modellen behöver.
const MSG_LIST_NOT_FOUND = 'No such list, or you have no access to it. Use list_lists for valid list ids.';
const MSG_WORD_NOT_FOUND = 'No such word, or you have no access to it. Use get_list to see word ids.';

/** Lyckat svar: { summary, data } som en textdel. */
function ok(summary, data, extra = {}) {
  return { content: [{ type: 'text', text: JSON.stringify({ summary, data, ...extra }) }] };
}

/**
 * Felsvar. `code`: invalid_input | not_found | forbidden | conflict |
 * rate_limited. Meddelandena skrivs för att den ANROPANDE MODELLEN ska kunna
 * rätta sig själv, inte för människor.
 */
function fail(code, message) {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }]
  };
}

/** Länk till listan i webbappen — så användaren kan klicka och öva direkt. */
function listUrl(listId) {
  return `${issuer()}/lists/${listId}`;
}

/**
 * Ladda en lista och avgör anroparens åtkomst. `level`:
 *   'read'  — ägare eller mottagare (sharedWith)          ≈ loadReadableList
 *   'edit'  — ägare, eller mottagare när shareMode 'edit'  ≈ loadEditableList
 *   'owner' — bara ägaren                                  ≈ loadOwnedList
 * Returnerar { list, isOwner } eller { error, code } (error = ett färdigt
 * fail()-kuvert, code = dess felkod).
 */
async function resolveList(userId, listId, level = 'read') {
  const denied = (code, message) => ({ error: fail(code, message), code });
  const id = String(listId);
  if (!mongoose.Types.ObjectId.isValid(id)) return denied('not_found', MSG_LIST_NOT_FOUND);
  const list = await GlosList.findOne({ _id: id, $or: [{ user: userId }, { sharedWith: userId }] });
  if (!list) return denied('not_found', MSG_LIST_NOT_FOUND);
  const isOwner = String(list.user) === String(userId);
  if (level === 'owner' && !isOwner) {
    return denied('forbidden', 'Only the owner of this list can do that — it was shared with you. Copy it in the Glosan app to get your own editable version.');
  }
  if (level === 'edit' && !isOwner && list.shareMode !== 'edit') {
    return denied('forbidden', 'This list was shared with you read-only; you cannot change its words.');
  }
  return { list, isOwner };
}

/** Kompakt listrad för listsvar. */
function listSummary(l, extra = {}) {
  return {
    list_id: String(l._id),
    title: l.title,
    description: l.description || '',
    source_lang: l.sourceLang,
    target_lang: l.targetLang,
    quiz_reversed: l.quizReversed ?? true,
    category_id: l.categoryId ? String(l.categoryId) : null,
    best_score: l.bestScore?.total > 0
      ? { correct: l.bestScore.correct, total: l.bestScore.total, achieved_at: l.bestScore.achievedAt || null }
      : null,
    updated_at: l.updatedAt,
    url: listUrl(l._id),
    ...extra
  };
}

/** Kompakt glosrad. */
function wordSummary(g, { withStats = true } = {}) {
  return {
    word_id: String(g._id),
    source: g.source,
    target: g.target,
    ...(g.notes ? { notes: g.notes } : {}),
    ...(g.exampleSentence ? { example_sentence: g.exampleSentence } : {}),
    ...(g.extra ? { extra: true } : {}),
    ...(withStats
      ? {
          stats: {
            correct: g.stats?.correct ?? 0,
            wrong: g.stats?.wrong ?? 0,
            last_reviewed_at: g.stats?.lastReviewedAt || null
          }
        }
      : {})
  };
}

/** Normaliserad nyckel för dubblettkoll av ett ordpar (skiftlägesokänslig). */
function pairKey(source, target) {
  const norm = (s) => String(s || '').trim().toLocaleLowerCase('sv').replace(/\s+/g, ' ');
  return `${norm(source)}\u0000${norm(target)}`;
}

/**
 * Dela upp inkommande ord i nya och dubbletter — mot listans befintliga ord
 * OCH inom själva batchen (ett foto kan råka läsa samma rad två gånger).
 */
function splitDuplicates(incoming, existing) {
  const seen = new Set(existing.map((g) => pairKey(g.source, g.target)));
  const fresh = [];
  const duplicates = [];
  for (const w of incoming) {
    const key = pairKey(w.source, w.target);
    if (seen.has(key)) {
      duplicates.push(w);
    } else {
      seen.add(key);
      fresh.push(w);
    }
  }
  return { fresh, duplicates };
}

/** Mongoose ValidationError → läsbart meddelande. */
function validationMessage(err) {
  return Object.values(err.errors || {}).map((e) => e.message).join(', ') || err.message;
}

module.exports = {
  objectId,
  MSG_LIST_NOT_FOUND,
  MSG_WORD_NOT_FOUND,
  ok,
  fail,
  listUrl,
  resolveList,
  listSummary,
  wordSummary,
  pairKey,
  splitDuplicates,
  validationMessage
};
