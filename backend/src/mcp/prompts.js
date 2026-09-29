// MCP-prompts — arbetsflödesmallar användaren kan välja i sin klient.
// Rena mallar: de rör aldrig databasen, de lär bara modellen HUR ett flöde med
// flera verktyg körs väl. Argument i MCP-prompts är alltid strängar.
const { z } = require('zod');
const { registerPrompt } = require('./registry');

const userMessage = (text) => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

registerPrompt({
  name: 'list_from_photo',
  title: 'Create a list from a photo',
  description: 'Turn a photo of a vocabulary sheet or textbook page into a Glosan list.',
  scope: 'write',
  argsSchema: {
    title: z.string().optional().describe('Title for the new list (optional)'),
    languages: z.string().optional().describe('e.g. "svenska–engelska" (optional — detected from the photo otherwise)')
  },
  handler: (args) => userMessage([
    'I have attached a photo of a vocabulary sheet. Please turn it into a Glosan list:',
    '1. Read every word pair in the photo. Keep accents, articles and slash alternatives exactly as printed; skip headings, page numbers and instructions. Do not guess at words you cannot read — list them for me instead.',
    '2. Fix only obvious misspellings and tell me each one.',
    `3. Show me the pairs, the languages${args.languages ? ` (${args.languages})` : ''} and a title${args.title ? ` ("${args.title}")` : ''} before saving.`,
    '4. When I say OK, create the list with all words in one create_list call and give me the link.',
    'If the photo has no attachment, ask me to attach one.'
  ].join('\n'))
});

registerPrompt({
  name: 'practice_hard_words',
  title: 'Practise my hardest words',
  description: 'Coach me in chat on the words I get wrong most often.',
  scope: 'read',
  argsSchema: {
    list: z.string().optional().describe('Name of one list to focus on (optional)')
  },
  handler: (args) => userMessage([
    `Use list_hard_words${args.list ? ` (find the list named "${args.list}" with list_lists first)` : ''} to find the words I struggle with most.`,
    'Then quiz me on them here in the chat, one word at a time: show the word, wait for my answer, tell me if it was right, and give a short memory tip when I miss.',
    'At the end, summarise which words still need work.'
  ].join('\n'))
});
