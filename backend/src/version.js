// Versionen som körs: release-taggen som byggdes in i imagen (APP_VERSION från
// .github/workflows/release.yml), annars package.json (lokalt och i test).
// Visas av /api/health, MCP-serverns info och get_source_info.
const pkg = require('../package.json');

module.exports = String(process.env.APP_VERSION || pkg.version).replace(/^v/, '');
