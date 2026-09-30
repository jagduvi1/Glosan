const { toolsForScopes, promptsForScopes } = require('./registry');
const { buildInstructions } = require('./instructions');
const { takeMutationSlot, takeWriteBytes } = require('./mutationBudget');
const version = require('../version');
require('./tools');   // registrera alla verktyg (sidoeffekt)
require('./prompts'); // registrera alla prompts (sidoeffekt)

// MCP-SDK:t laddas via dynamisk import() och cachas — samma mönster som
// Cellarion kör i produktion. Lazy: backend-boot betalar inte för det, och
// jest (som inte kan ladda SDK:ts ESM-beroenden) kan require:a modulen fritt.
let sdkPromise;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import('@modelcontextprotocol/sdk/server/mcp.js'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js')
    ]).then(([mcp, http]) => ({
      McpServer: mcp.McpServer,
      StreamableHTTPServerTransport: http.StreamableHTTPServerTransport
    })).catch((err) => {
      // Cacha aldrig en misslyckad import — ett tillfälligt fel skulle annars
      // förgifta varje framtida /api/mcp-anrop tills processen startas om.
      sdkPromise = undefined;
      throw err;
    });
  }
  return sdkPromise;
}

// En JSON-RPC-body kan vara en BATCH, så ett HTTP-anrop kan bli många
// verktygsanrop. Det här taket per request är generöst för en riktig agent
// men långt under missbruksnivå.
const MAX_CALLS_PER_REQUEST = 20;

const rateLimited = (message) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code: 'rate_limited', message } }) }]
});

/**
 * Linda en verktygshandler med budgetarna: anrop per request, plus
 * per-användar-budgeten för skrivande verktyg. `state` delas av alla verktyg i
 * EN requests server-instans. Exporterad för enhetstest.
 */
function budgetedHandler(tool, ctx, state) {
  return async (args) => {
    state.calls += 1;
    if (state.calls > MAX_CALLS_PER_REQUEST) {
      return rateLimited(`Too many tool calls in one request (max ${MAX_CALLS_PER_REQUEST}). Send fewer calls per batch.`);
    }
    if (tool.annotations?.readOnlyHint === false && !takeMutationSlot(ctx.user.id)) {
      return rateLimited('Too many changes in a short time — wait a few minutes before changing more. Reads still work.');
    }
    if (tool.annotations?.readOnlyHint === false && !takeWriteBytes(ctx.user.id, JSON.stringify(args || {}).length)) {
      return rateLimited('This account has written a lot of content today — the daily limit is reached. Try again tomorrow; reads still work.');
    }
    try {
      return await tool.handler(args || {}, ctx);
    } catch (err) {
      // Ett oväntat fel blir ett ordnat felkuvert i stället för ett protokoll-
      // fel — modellen kan då berätta för användaren. Detaljerna stannar i loggen.
      console.error(`[mcp] tool ${tool.name} failed:`, err.message);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: { code: 'internal', message: 'Something went wrong on the Glosan server. Try again in a moment.' } }) }]
      };
    }
  };
}

function budgetedPromptHandler(prompt, state) {
  return (args) => {
    state.calls += 1;
    if (state.calls > MAX_CALLS_PER_REQUEST) {
      throw new Error(`rate_limited: too many calls in one request (max ${MAX_CALLS_PER_REQUEST})`);
    }
    return prompt.handler(args || {});
  };
}

/**
 * Bygg en MCP-server per request som exponerar BARA de verktyg anslutningens
 * scopes tillåter. Ett otillåtet verktyg registreras aldrig — det är inte
 * gömt i tools/list, det är oanropbart ("unknown tool"). Scope-skyddet är
 * alltså strukturellt, inte ett filter en klient kan prata sig förbi.
 * ctx = { user, scopes, features } — features = användarens effektiva
 * funktionsflaggor; verktyg för en dold modul registreras bara med flaggan.
 */
async function buildServer(ctx) {
  const { McpServer } = await loadSdk();
  const features = ctx.features || [];
  const server = new McpServer(
    { name: 'glosan', version },
    { instructions: buildInstructions(features) }
  );
  const state = { calls: 0 };
  for (const tool of toolsForScopes(ctx.scopes, features)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      },
      budgetedHandler(tool, ctx, state)
    );
  }
  for (const prompt of promptsForScopes(ctx.scopes, features)) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: prompt.argsSchema },
      budgetedPromptHandler(prompt, state)
    );
  }
  return server;
}

/**
 * Serva ett stateless Streamable HTTP-anrop: ny server + transport per request
 * (ingen session hålls), rivs när svaret stängs. Glosan behöver inga push-
 * notiser, så stateless räcker gott och är billigast.
 */
async function handleMcpRequest(req, res, ctx) {
  const { StreamableHTTPServerTransport } = await loadSdk();
  const server = await buildServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    // close() är async — en synkron try/catch fångar inte ett avvisat promise,
    // och Node 20 kraschar processen på en ohanterad rejection.
    Promise.resolve().then(() => transport.close()).catch(() => {});
    Promise.resolve().then(() => server.close()).catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

module.exports = { handleMcpRequest, budgetedHandler, MAX_CALLS_PER_REQUEST };
