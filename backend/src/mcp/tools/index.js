// Laddar alla verktygsmoduler (var och en registrerar sina verktyg vid
// require). server.js kräver den här en gång så registret är fullt före första
// requesten. Nya verktygsfiler läggs till här.
require('./meta');
require('./lists');
require('./words');
require('./categories');
require('./study');

module.exports = {};
