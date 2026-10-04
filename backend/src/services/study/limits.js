// Tak för Plugga-innehåll per konto och område — samma för AI:n (MCP) och för
// kopior som kommer när någon delar ett område.

// Aktiva (ej arkiverade) områden per konto, och ett hårt tak med arkiverade.
const MAX_UNITS_PER_USER = 1000;
const MAX_UNITS_TOTAL = 3000;
const MAX_PAGES_PER_UNIT = 30;
const MAX_ITEMS_PER_UNIT = 500;
// Kort och övningar sammanlagt per konto — en skolgång ryms, en AI i loop inte.
const MAX_ITEMS_PER_ACCOUNT = 10000;

module.exports = { MAX_UNITS_PER_USER, MAX_UNITS_TOTAL, MAX_PAGES_PER_UNIT, MAX_ITEMS_PER_UNIT, MAX_ITEMS_PER_ACCOUNT };
