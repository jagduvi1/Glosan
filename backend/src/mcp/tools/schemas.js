// Delade zod-former för verktygens input. Gränserna speglar modellerna
// (models/Glos.js, models/GlosList.js) så ett fel fångas i MCP-lagret med ett
// begripligt meddelande i stället för som en Mongoose-ValidationError.
const { z } = require('zod');

// Ett foto av ett glosblad är sällan över ~60 ord; 300 räcker gott för en
// hel kapitelordlista utan att ett anrop kan spräcka allt.
const MAX_WORDS_PER_CALL = 300;
// Tak för hur stor en lista får växa via MCP (get_list returnerar hela listan).
const MAX_WORDS_PER_LIST = 1000;

const langCode = z.string().trim().toLowerCase()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'must be an ISO 639-1 language code like "sv", "en", "de"')
  .max(10);

const wordInput = z.object({
  source: z.string().trim().min(1).max(200).describe('The word or phrase in the list\'s source_lang'),
  target: z.string().trim().min(1).max(200).describe('Its translation in the list\'s target_lang'),
  notes: z.string().trim().max(500).optional().describe('Optional note, e.g. grammar hint or irregular forms'),
  example_sentence: z.string().trim().max(500).optional().describe('Optional example sentence'),
  extra: z.boolean().optional().describe('true = a bonus word the user did NOT get as homework (e.g. a suggestion you added). Leave unset for words from the user\'s own sheet.')
});

module.exports = { wordInput, langCode, MAX_WORDS_PER_CALL, MAX_WORDS_PER_LIST };
