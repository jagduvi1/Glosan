// Deklarativt register för MCP-verktyg och -prompts. Porterat från Cellarion
// (src/mcp/registry.js), utan resources/deprecation.
//
// Varje verktyg är ett objekt: { name, title, description, scope, inputSchema,
// annotations, handler }. Ett och samma register styr (a) vilka verktyg en
// klient ser — filtrerat på anslutningens scopes, så en läs-anslutning aldrig
// ens SER skrivverktygen — och (b) vilken handler som körs. Ett nytt verktyg är
// en registerTool()-rad; ingen route-koppling, ingen scope-check att glömma.
//
// `scope`: 'public' (varje autentiserad anslutning) eller ett token-scope
// ('read' | 'write').
//
// `feature` (valfritt): en funktionsflagga (config/features.js) som krävs —
// verktyg för en dold modul registreras bara för användare med flaggan, så
// för alla andra finns de inte ens (samma strukturella filter som scopes).

const tools = [];
const prompts = [];

/**
 * @param {object} def
 * @param {string}   def.name          unikt snake_case-namn
 * @param {string}   def.title         kort titel
 * @param {string}   def.description   NÄR + VAD — styr modellens verktygsval
 * @param {string}   def.scope         'public' | 'read' | 'write'
 * @param {object}   [def.inputSchema] zod raw shape ({} = inga parametrar)
 * @param {object}   [def.annotations] MCP-hints (readOnlyHint, destructiveHint …)
 * @param {string}   [def.feature]     funktionsflagga som krävs, t.ex. 'study'
 * @param {Function} def.handler       async (args, ctx) => ({ content: [...] })
 */
function registerTool(def) {
  if (!def || typeof def.name !== 'string' || typeof def.handler !== 'function') {
    throw new Error('registerTool: name and handler are required');
  }
  if (typeof def.scope !== 'string') {
    throw new Error(`registerTool(${def.name}): scope is required`);
  }
  if (tools.some((t) => t.name === def.name)) {
    throw new Error(`registerTool: duplicate tool name "${def.name}"`);
  }
  tools.push({ inputSchema: {}, annotations: {}, ...def });
}

/** True när en anslutning med `tokenScopes` får nå något som kräver `required`. */
function scopeSatisfies(tokenScopes, required) {
  if (required === 'public') return true;
  return Array.isArray(tokenScopes) && tokenScopes.includes(required);
}

/** True när en användare med `features` får se något som kräver `feature`. */
function featureSatisfies(features, feature) {
  return !feature || (Array.isArray(features) && features.includes(feature));
}

function toolsForScopes(tokenScopes, features = []) {
  return tools.filter((t) => scopeSatisfies(tokenScopes, t.scope) && featureSatisfies(features, t.feature));
}

function allTools() {
  return tools.slice();
}

/**
 * MCP-prompts = arbetsflödesmallar användaren kan välja (snedstrecks-
 * kommandon i de flesta klienter). Rena mallar — handlern interpolerar
 * argument till text och rör aldrig databasen.
 * @param {object} def { name, title, description, scope, argsSchema?, handler }
 */
function registerPrompt(def) {
  if (!def || typeof def.name !== 'string' || typeof def.handler !== 'function') {
    throw new Error('registerPrompt: name and handler are required');
  }
  if (typeof def.scope !== 'string') {
    throw new Error(`registerPrompt(${def.name}): scope is required`);
  }
  if (prompts.some((p) => p.name === def.name)) {
    throw new Error(`registerPrompt: duplicate prompt name "${def.name}"`);
  }
  prompts.push({ argsSchema: {}, ...def });
}

function promptsForScopes(tokenScopes, features = []) {
  return prompts.filter((p) => scopeSatisfies(tokenScopes, p.scope) && featureSatisfies(features, p.feature));
}

function allPrompts() {
  return prompts.slice();
}

module.exports = {
  registerTool, toolsForScopes, scopeSatisfies, featureSatisfies, allTools,
  registerPrompt, promptsForScopes, allPrompts
};
