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

// ── Plugga (funktionsflaggan 'study') ────────────────────────────────────────

registerPrompt({
  name: 'study_from_photos',
  title: 'Plugga: skapa ett område från bokens sidor',
  description: 'Turn photos of textbook pages (any subject) into a Plugga unit with genomgång, flashcards and exercises on the book\'s levels.',
  scope: 'write',
  feature: 'study',
  argsSchema: {
    subject: z.string().optional().describe('e.g. "matte", "fysik", "historia" (optional — detected from the photos)'),
    grade: z.string().optional().describe('Årskurs, e.g. "8" (optional — you will be asked)'),
    test_date: z.string().optional().describe('When the test is, if there is one')
  },
  handler: (args) => userMessage([
    'Jag har bifogat foton från min lärobok. Hjälp mig plugga på det här i Glosan:',
    `1. ${args.grade ? `Jag går i årskurs ${args.grade} — bekräfta det.` : 'Fråga vilken årskurs jag går i innan du skapar något.'}${args.test_date ? ` Provet är ${args.test_date}.` : ' Fråga om det är ett prov på gång.'}`,
    `2. Ta reda på ämne${args.subject ? ` (${args.subject})` : ''}, bok, kapitel och vilka nivåer boken visar (lätt/medel/svår).`,
    '3. Föreslå vad du skapar — genomgång, kort, och egna övningar på bokens nivåer (E/C/A) — och vänta på mitt OK.',
    '4. Skapa området, kontrollera alla svar och ge mig länken.',
    'Om inga foton är bifogade: be mig fota sidorna.'
  ].join('\n'))
});

registerPrompt({
  name: 'check_my_solution',
  title: 'Plugga: rätta min lösning på papper',
  description: 'Check a photographed handwritten solution to a Plugga exercise (code like MA3-14) and record the result.',
  scope: 'write',
  feature: 'study',
  argsSchema: {
    code: z.string().optional().describe('The exercise code, e.g. "MA3-14" (optional — read from the photo)')
  },
  handler: (args) => userMessage([
    `Här är ett foto av min lösning${args.code ? ` på uppgift ${args.code}` : ''}. Koden står överst på pappret.`,
    'Hämta uppgiften i Glosan och rätta min lösning: vad är rätt, var blir det fel första gången, ge mig en ledtråd (inte hela lösningen) och säg vad som skulle lyfta den till nästa nivå.',
    'Spara sedan resultatet och din återkoppling i Glosan.',
    'Om det inte finns något foto eller koden inte syns: fråga mig.'
  ].join('\n'))
});

registerPrompt({
  name: 'prepare_for_test',
  title: 'Plugga: förbered mig inför provet',
  description: 'Plan the days before a test: what to repeat in the app, and a practice test that looks like the real one.',
  scope: 'write',
  feature: 'study',
  argsSchema: {
    unit: z.string().optional().describe('Which unit or chapter (optional — you will be asked)'),
    test_date: z.string().optional().describe('When the test is')
  },
  handler: (args) => userMessage([
    `Jag har prov${args.test_date ? ` ${args.test_date}` : ''}${args.unit ? ` på ${args.unit}` : ''}. Hjälp mig förbereda mig i Glosan:`,
    '1. Hitta området och se vad jag kan och vad jag brukar missa.',
    '2. Fråga hur det riktiga provet brukar se ut (tid, miniräknare, typ av frågor) och gör ett övningsprov som liknar det, om det inte redan finns ett.',
    '3. Ge mig en plan dag för dag fram till provet: vad jag ska repetera i appen, när jag ska göra övningsprovet och vad jag ska fokusera på.',
    'Spara provdatumet på området om det inte redan står där.'
  ].join('\n'))
});

registerPrompt({
  name: 'check_my_test',
  title: 'Plugga: rätta mitt övningsprov på papper',
  description: 'Check a practice test done on paper (photos of the answers) and record the points per question.',
  scope: 'write',
  feature: 'study',
  argsSchema: {
    code: z.string().optional().describe('Any question code on the test, e.g. "MA3-31" (optional — read from the photos)')
  },
  handler: (args) => userMessage([
    `Här är foton av mina svar på ett övningsprov${args.code ? ` (en av frågorna har koden ${args.code})` : ''}. Koden står vid varje fråga.`,
    'Hämta provet i Glosan och rätta varje fråga mot facit: poäng per nivå (E/C/A) och en kort kommentar per fråga.',
    'Spara resultatet i Glosan med en sammanfattning: vad gick bra, vad ska jag öva mer på och vad skulle lyfta betyget.',
    'Om ett foto är oläsligt eller en kod saknas: fråga mig.'
  ].join('\n'))
});
