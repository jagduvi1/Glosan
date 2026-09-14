const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// Bildtolkning går på Sonnet 5 i stället för Haiku. Ett fotat glosblad är
// snett, skuggat och ibland handskrivet — precis den sortens uppgift där
// CLAUDE.md säger att vi ska gå upp en nivå. Textflödena ligger kvar på
// Haiku, som är snabbare och billigare och klarar ren text bra.
const VISION_MODEL = 'claude-sonnet-5';

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function isEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Pull JSON out of a Claude response. Models sometimes wrap JSON in prose or
// ```json fences — strip both before parsing. Returns null if no JSON found.
function extractJSON(text) {
  if (!text) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.search(/[{[]/);
  if (start === -1) return null;
  const slice = candidate.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// `user` är antingen en sträng eller en array av content-block (t.ex.
// [{type:"image",...},{type:"text",...}] för bildtolkning) — Messages API
// tar emot båda formerna i samma fält.
async function complete({ system, user, maxTokens = 1024, model = DEFAULT_MODEL }) {
  const c = getClient();
  if (!c) throw new Error('Anthropic API key not configured');

  const response = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { isEnabled, complete, extractJSON, DEFAULT_MODEL, VISION_MODEL };
