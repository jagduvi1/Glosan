// Webbläsartest mot en KÖRANDE Glosan (via nginx), i mobilstorlek (390 px):
// det API-testerna inte ser — sidor, dialoger, omdirigeringar, texterna
// eleverna läser. Kör efter de andra e2e-skripten (samma stack):
//
//   FRONTEND_URL=http://localhost:8080 docker compose up --build -d
//   cd backend && node scripts/browser-e2e.mjs http://localhost:8080
//
// Chrome: CHROME_PATH, annars standardplatsen för Windows, macOS och Linux.
// En sida som kastar ett fel (pageerror/console.error) underkänner testet.
// Vid fel sparas en skärmdump i BROWSER_SHOTS (standard: ./browser-shots).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { e2e, grantFeatureInLocalDb, setStreakInLocalDb, setNeedsUsernameInLocalDb } from './lib/e2e.mjs';

const { BASE, ok, api, register, connectMcp, call } = e2e(process.argv[2]);
const SHOTS = path.resolve(process.env.BROWSER_SHOTS || 'browser-shots');
const PASSWORD = 'E2e-Passw0rd!x'; // samma som register() i lib/e2e.mjs
const CHROME = process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}[process.platform] || '/usr/bin/google-chrome';

const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`pageerror ${page.url()}: ${e.message}`));
  // 401 från refresh-proben (utloggad) är väntad — inget fel i appen.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console ${page.url()}: ${m.text()}`);
  });
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Väntar tills elementet finns: dialoger visar "Laddar…" en stund innan
// innehållet kommer (i CI:s långsammare Chrome hann testet före).
async function clickText(page, selector, text, timeout = 10000) {
  const found = await page
    .waitForFunction((sel, t) => [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(t)) || null, { timeout }, selector, text)
    .catch(() => null);
  const el = found && found.asElement();
  if (!el) throw new Error(`no ${selector} containing "${text}" on ${page.url()}`);
  await el.click();
}
// Töm ett fält som man gör för hand (markera allt, radera) — så React ser
// ändringen. select() i stället för Ctrl+A, som inte markerar allt på macOS.
async function clearInput(page, el) {
  await el.click();
  await el.evaluate((input) => input.select());
  await page.keyboard.press('Backspace');
}
const waitForText = (page, text, timeout = 10000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

async function login(page, user) {
  // Inloggningssidans kod kan fortfarande laddas (ett hopp i appen i en ny kontext).
  await page.waitForSelector('input.inp');
  const inputs = await page.$$('input.inp');
  await inputs[0].type(user.name);
  await inputs[1].type(PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type="submit"]')]);
}

async function main() {
  console.log(`Browser e2e against ${BASE} (Chrome: ${CHROME})`);
  const users = [];
  const signUp = async (prefix) => { const u = await register(prefix); users.push(u); return u; };
  let browser = null;
  let page = null;
  let current = null; // sidan som körs just nu — den som skärmdumpas vid fel
  try {
    // ── data via API/MCP ────────────────────────────────────────────────────
    const A = await signUp('bra');
    const B = await signUp('brb');
    // Plugga är på för alla sedan v0.1.39 — B har ingen egen flagga.
    if ((await api('/api/study/overview', A.token)).status !== 200) grantFeatureInLocalDb(A.name, 'study');
    else assert.equal((await api('/api/study/overview', B.token)).status, 200, 'Plugga is on for an account without a flag of its own');
    const claude = await connectMcp(A.token);
    const unitIds = [];
    for (const [subject, title] of [['matematik', 'Procent'], ['matematik', 'Förändringsfaktor'], ['historia', 'Industriella revolutionen']]) {
      const u = await call(claude, 'create_study_unit', { subject, grade_year: 8, title });
      unitIds.push(u.data.unit_id);
      // Första kortets baksida har en enkel radbrytning (se kortsteget nedan).
      const back = unitIds.length === 1 ? 'Rad ett\nRad två' : 'Svar';
      await call(claude, 'add_flashcards', { unit_id: u.data.unit_id, cards: [{ front: 'Fråga', back }] });
    }
    await claude.close();
    const code = (await api('/api/me/invite-codes', A.token, { method: 'POST' })).body.inviteCode.code;
    assert.ok((await api('/api/me/friends/by-code', B.token, { method: 'POST', body: { code } })).status < 300);
    const list = await api('/api/lists', A.token, { method: 'POST', body: { title: 'Djur', sourceLang: 'sv', targetLang: 'en' } });
    const listId = list.body.list._id;
    await api(`/api/lists/${listId}/glosor`, A.token, { method: 'POST', body: { source: 'häst', target: 'horse' } });
    // En trasig förfrågan får aldrig ta ner servern: ett tal som kompiskod
    // kastade förut utanför try, och Node avslutade processen.
    assert.equal((await api('/api/me/friends/by-code', B.token, { method: 'POST', body: { code: 12345678 } })).status, 400);
    await pause(300);
    assert.equal((await api('/api/health')).status, 200, 'the backend is still up');
    ok('two users (friends), three Plugga units, a list with one word — and a malformed request is a 400, not a crash');

    // ── app-ikonerna: flikar, bokmärken och "Lägg till på hemskärmen" ────────
    // (även content-type: en saknad fil får inte slinka igenom som appens HTML)
    const manifest = await fetch(`${BASE}/manifest.json`).then((r) => r.json());
    for (const src of ['favicon.ico', 'apple-touch-icon.png', ...manifest.icons.map((i) => i.src)]) {
      const r = await fetch(`${BASE}/${src.replace(/^\//, '')}`);
      assert.equal(r.status, 200, `${src} is served`);
      assert.match(r.headers.get('content-type') || '', /^image\//, `${src} is an image`);
    }
    ok('the favicon, the home-screen icons and the manifest\'s icons are served');

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []
    });
    page = await browser.newPage();
    current = page;
    watch(page);
    await page.setViewport({ width: 390, height: 844 });

    // ── utloggad: framsidan visar Plugga och leder till AI-guiden ────────────
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'alla ämnen');
    await clickText(page, 'button', 'Så kopplar du din AI');
    await page.waitForFunction(() => window.location.pathname === '/koppla-ai');
    await waitForText(page, 'Koppla din AI till Glosan');
    await waitForText(page, 'Register automatically');
    await page.waitForFunction(() => /\/api\/mcp$/.test(document.querySelector('code')?.textContent || ''));
    // En AI som loggar in på ett sätt Glosan inte stöder (Claudes "published
    // identity") — browsern får en sida som säger vad man gör, ingen redirect.
    const unknownAi = await fetch(`${BASE}/api/mcp/oauth/authorize?client_id=${encodeURIComponent('https://claude.ai/oauth/mcp-oauth-client-metadata')}`, {
      headers: { Accept: 'text/html' },
      redirect: 'manual'
    });
    assert.equal(unknownAi.status, 400);
    assert.match(await unknownAi.text(), /Register automatically/);
    ok('logged out: the front page shows Plugga and leads to the AI guide (address, Claude steps); an AI Glosan doesn\'t recognise gets a page saying what to do');

    // ── inloggning: tillbaka dit man skulle ─────────────────────────────────
    await page.goto(`${BASE}/plugga`, { waitUntil: 'networkidle0' });
    assert.equal(new URL(page.url()).pathname, '/login');
    await login(page, A);
    assert.equal(new URL(page.url()).pathname, '/plugga', 'back on the Plugga page after logging in');
    // …och kvar där: /login-vakten skickade förut vidare till /lists en stund
    // efter att sidan själv navigerat (React Router 7 byter sida i en transition).
    await pause(2000);
    assert.equal(new URL(page.url()).pathname, '/plugga', 'still on the Plugga page a moment later');
    await page.goto(`${BASE}/finns-inte`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'vilse');
    ok('a Plugga page sends you to login and back again; unknown pages show the 404 page');

    // ── Plugga: Dela flera områden ──────────────────────────────────────────
    await page.goto(`${BASE}/plugga`, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'Dela');
    await page.waitForSelector('#share-study-title');
    await waitForText(page, 'Vad vill du dela?');
    await clickText(page, '.modal button', 'Välj alla');
    await clickText(page, '.modal label', B.name);
    await clickText(page, '.modal button', 'Dela 3');
    await waitForText(page, 'Klart!');
    const bUnits = (await api('/api/study/units?allTerms=1', B.token)).body.units;
    assert.equal(bUnits.length, 3, 'the friend has all three units');
    await clickText(page, '.modal button[role="tab"]', 'QR-kod');
    await page.waitForSelector('.modal input.inp');
    await page.type('.modal input.inp', 'Allt inför provet');
    await clickText(page, '.modal button', 'Skapa QR-kod för 3');
    await page.waitForSelector('.modal img[alt^="QR"]');
    const shareUrl = await page.$eval('.modal', (m) => (m.textContent.match(/https?:\/\/[^\s]+\/p\/[A-Z0-9]+/) || [])[0]);
    assert.ok(shareUrl, 'the QR card shows the link');
    ok('Plugga: Dela picks your units, shares all three with a friend and makes ONE QR code for them');

    // ── länken för någon utan konto ─────────────────────────────────────────
    const guest = await browser.createBrowserContext();
    const gpage = await guest.newPage();
    current = gpage;
    watch(gpage);
    await gpage.setViewport({ width: 390, height: 844 });
    await gpage.goto(shareUrl.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle0' });
    await waitForText(gpage, 'Allt inför provet');
    await waitForText(gpage, 'delar 3 områden med dig');
    await waitForText(gpage, 'Skapa konto');
    // En klasskompis med konto: "Jag har konto" → logga in → tillbaka till
    // länken och med i områdena (inte bara till listorna).
    const C = await signUp('brc');
    await Promise.all([gpage.waitForNavigation({ waitUntil: 'networkidle0' }), clickText(gpage, 'button, a', 'Jag har konto')]);
    assert.equal(new URL(gpage.url()).pathname, '/login');
    await login(gpage, C);
    await gpage.waitForFunction(() => /^\/plugga/.test(location.pathname), { timeout: 10000 });
    await pause(1500);
    assert.match(new URL(gpage.url()).pathname, /^\/plugga/, 'lands in Plugga, not on /lists');
    assert.equal((await api('/api/study/units?allTerms=1', C.token)).body.units.length, 3, 'joined all three units');
    await guest.close();
    current = page;
    ok('the link shows its name and all three units to someone without an account; logging in from it joins them');

    // ── ämnessidan ──────────────────────────────────────────────────────────
    await page.goto(`${BASE}/plugga/amne/matematik`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Förändringsfaktor');
    await clickText(page, 'button', 'Dela');
    await page.waitForSelector('#share-study-title');
    await page.keyboard.press('Escape');
    ok('the subject page has its own Dela button');

    // ── dela vidare: den som fått något kan dela det ────────────────────────
    assert.equal((await api(`/api/lists/${listId}/share`, A.token, { method: 'POST', body: { friendIds: [B.id] } })).status, 200);
    const bctx = await browser.createBrowserContext();
    const bpage = await bctx.newPage();
    current = bpage;
    watch(bpage);
    await bpage.setViewport({ width: 390, height: 844 });
    await bpage.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await login(bpage, B);
    // B fick en egen kopia av A:s områden — och delar den som allt annat B har.
    const bCopy = (await api('/api/study/units?allTerms=1', B.token)).body.units.find((u) => u.title === 'Förändringsfaktor');
    assert.ok(bCopy && bCopy.isCopy && bCopy.id !== unitIds[1], 'the friend got a copy of their own');
    await bpage.goto(`${BASE}/plugga/omrade/${bCopy.id}`, { waitUntil: 'networkidle0' });
    await waitForText(bpage, `din kopia från ${A.name}`);
    await clickText(bpage, 'button', 'Dela');
    await bpage.waitForSelector('#share-unit-title');
    await waitForText(bpage, 'får en egen kopia');
    await clickText(bpage, '.modal button[role="tab"]', 'QR-kod');
    await clickText(bpage, '.modal button', 'Skapa QR-kod');
    await bpage.waitForSelector('.modal img[alt^="QR"]');
    assert.equal((await api(`/api/study/units/${bCopy.id}/shares`, B.token)).body.links.length, 1, 'B made a link to B\'s copy');
    // Stäng med × — fokus har lämnat dialogen när skapa-knappen försvann, så Escape når den inte.
    await bpage.click('.modal button[aria-label="Stäng"]');
    await bpage.waitForFunction(() => !document.querySelector('#share-unit-title'));
    // Kopian är B:s: B kan ta bort den i appen (här bara fram till frågan).
    await clickText(bpage, 'button', 'Ta bort kopian');
    await waitForText(bpage, 'Ta bort din kopia?');
    await clickText(bpage, '.modal button', 'Avbryt');
    await bpage.goto(`${BASE}/lists/${listId}`, { waitUntil: 'networkidle0' });
    await waitForText(bpage, `delad av ${A.name}`);
    await clickText(bpage, 'button', 'Dela med kompis');
    await waitForText(bpage, 'Bara den som äger listan kan ändra den');
    await bctx.close();
    current = page;
    ok('a friend who got a unit gets their own copy ("din kopia från …"), shares it on and can delete it; a list they got can be passed on too');

    // ── kortets baksida: en enkel radbrytning ska synas (inte flyta ihop) ────
    await page.goto(`${BASE}/plugga/ova?units=${unitIds[0]}`, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'Vänd kortet');
    await page.waitForFunction(() => [...document.querySelectorAll('.study-md')].some((el) => el.textContent.includes('Rad två')));
    const backHtml = await page.$$eval('.study-md', (els) => els.map((el) => el.innerHTML).find((h) => h.includes('Rad två')));
    assert.match(backHtml, /Rad ett<br\s*\/?>\s*Rad två/, `a single line break on a card back is kept: ${backHtml}`);
    ok('a single line break on a Plugga card back shows as a line break');

    // ── övningsblad: Skriv ut från områdessidan — facit sist, ingen panel på pappret ──
    await page.goto(`${BASE}/plugga/omrade/${unitIds[0]}`, { waitUntil: 'networkidle0' });
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickText(page, 'button', 'Skriv ut')]);
    assert.equal(new URL(page.url()).pathname, '/plugga/skriv-ut');
    await page.waitForSelector('.test-sheet .sheet-facit');
    const sheetText = await page.$eval('.test-sheet', (el) => el.innerText);
    assert.match(sheetText, /Övningsblad: Procent/);
    assert.match(sheetText, /Facit[\s\S]*Rad två/, 'the card\'s back is in the facit');
    await clickText(page, 'label', 'Facit');
    await page.waitForFunction(() => !document.querySelector('.sheet-facit'));
    await page.emulateMediaType('print');
    assert.equal(await page.$eval('.sheet-controls', (el) => getComputedStyle(el).display), 'none', 'the sheet\'s controls are not printed');
    assert.equal(await page.$eval('.test-sheet', (el) => getComputedStyle(el).display), 'block', 'the sheet itself is');
    await page.emulateMediaType(null);
    ok('Skriv ut on a unit gives an övningsblad with the facit last (can be left out), and no controls on paper');

    // ── glos-quiz: ärlig återkoppling ───────────────────────────────────────
    for (const [answer, expected] of [['dog', 'Inte riktigt — rätt svar: häst'], ['hast', 'Nära! Det stavas häst']]) {
      await page.goto(`${BASE}/lists/${listId}/quiz`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('input.inp, input[type="text"]');
      await page.type('input.inp, input[type="text"]', answer);
      await page.keyboard.press('Enter');
      await waitForText(page, expected);
    }
    ok('the quiz says "Inte riktigt" for a wrong word and "Nära!" only for a near miss');

    // ── glos-listans QR: kompisar bara om man kryssar i ─────────────────────
    await page.goto(`${BASE}/lists/${listId}`, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'QR-kod för klassen');
    await page.waitForSelector('.modal');
    await clickText(page, '.modal summary', 'Skapa ny länk');
    const ticked = await page.$eval('.modal input[type="checkbox"]', (c) => c.checked);
    assert.equal(ticked, false, '"Bli kompisar" is off by default');
    await clickText(page, '.modal button', 'Generera ny QR-länk');
    await page.waitForSelector('.modal img[alt="QR-kod"]');
    const listCode = await page.$eval('.modal', (m) => (m.textContent.match(/\/j\/([A-Z0-9]+)/) || [])[1]);
    const listPreview = await api(`/api/list-invite/${listCode}`);
    assert.equal(listPreview.body.befriend, false);
    await page.keyboard.press('Escape');
    ok('a list QR code makes nobody a friend unless you tick "Bli kompisar"');

    // ── resten av glos-sidorna laddar ───────────────────────────────────────
    for (const p of [`/lists`, `/lists/${listId}/flashcards`, `/lists/${listId}/galge`, `/lists/${listId}/ordfall`, '/profile', '/integritet', '/koppla-ai', '/om']) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0' });
      await pause(200);
    }
    await waitForText(page, 'Vem driver Glosan?'); // Om Glosan
    ok('lists, flashcards, galge, ordfall, profile, the privacy page, the AI guide and Om Glosan load');

    // ── streak: det som visas är streaken som den är nu ──────────────────────
    // En missad dag ger 0; flashkort och dueller räknas som övning; har man
    // inte övat idag är flamman grå och listsidan påminner.
    const D = await signUp('brd');
    const E = await signUp('bre');
    const dInvite = (await api('/api/me/invite-codes', D.token, { method: 'POST' })).body.inviteCode.code;
    assert.ok((await api('/api/me/friends/by-code', E.token, { method: 'POST', body: { code: dInvite } })).status < 300);
    const dList = (await api('/api/lists', D.token, { method: 'POST', body: { title: 'Färger', sourceLang: 'sv', targetLang: 'en' } })).body.list._id;
    await api(`/api/lists/${dList}/glosor`, D.token, { method: 'POST', body: { source: 'röd', target: 'red' } });
    const streakOf = async (u) => (await api('/api/me/profile', u.token)).body.streak;
    setStreakInLocalDb(E.name, 3, 2); // övade senast i förrgår: bruten
    const eBroken = await streakOf(E);
    assert.deepEqual([eBroken.current, eBroken.longest, eBroken.today], [0, 3, false], 'a missed day shows 0 before it is recounted');
    assert.equal((await api('/api/me/friends', D.token)).body.friends.find((f) => f.username === E.name).streak.current, 0, 'friends see 0 too');
    const duel = await api('/api/duels', D.token, { method: 'POST', body: { listId: dList, opponentIds: [E.id] } });
    assert.equal(duel.status, 201, JSON.stringify(duel.body));
    assert.equal((await api(`/api/duels/${duel.body.duel._id}/submit`, E.token, { method: 'POST', body: { correct: 1, total: 1, durationMs: 900 } })).status, 200);
    const ePlayed = await streakOf(E);
    assert.deepEqual([ePlayed.current, ePlayed.today], [1, true], 'a played duel is a practice day (starting over after the missed day)');
    setStreakInLocalDb(D.name, 4, 1); // övade senast igår: lever, men inte gjort idag
    const dctx = await browser.createBrowserContext();
    const dpage = await dctx.newPage();
    current = dpage;
    watch(dpage);
    await dpage.setViewport({ width: 390, height: 844 });
    await dpage.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await login(dpage, D);
    await waitForText(dpage, 'öva idag så håller streaken');
    await dpage.waitForSelector('[title="4 dagar i rad — öva idag så håller streaken"]');
    await dpage.goto(`${BASE}/lists/${dList}/flashcards`, { waitUntil: 'networkidle0' });
    await dpage.click('.flashcard');
    await dpage.waitForSelector('[title="5 dagar i rad"]');
    const dDone = await streakOf(D);
    assert.deepEqual([dDone.current, dDone.today], [5, true], 'going through the flashcards counts');
    await dpage.goto(`${BASE}/lists`, { waitUntil: 'networkidle0' });
    assert.ok(!(await dpage.evaluate(() => document.body.innerText.includes('öva idag så håller streaken'))), 'no reminder once today is done');
    await dctx.close();
    current = page;
    ok('streaks: a missed day shows 0 (to friends too); duels and flashcards count; the flame is grey with a reminder until today is done');

    // ── användarnamn: byt under Profil (en gång i veckan) och välj vid första
    // Google-inloggningen (needsUsername, här satt direkt i databasen) ───────
    const F = await signUp('brf');
    const G = await signUp('brg');
    const fName = `ny${F.name.slice(-6)}`;
    const gName = `vald${G.name.slice(-6)}`;
    const fctx = await browser.createBrowserContext();
    const fpage = await fctx.newPage();
    current = fpage;
    watch(fpage);
    await fpage.setViewport({ width: 390, height: 844 });
    await fpage.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await login(fpage, F);
    await fpage.goto(`${BASE}/profile`, { waitUntil: 'networkidle0' });
    await clickText(fpage, 'button', 'Byt namn');
    const nameInput = await fpage.waitForSelector('input[autocomplete="username"]');
    await clearInput(fpage, nameInput);
    await nameInput.type('a b'); // ogiltigt: mellanslag
    await clickText(fpage, 'form button', 'Spara');
    await waitForText(fpage, 'inga mellanslag');
    await clearInput(fpage, nameInput);
    await nameInput.type(fName.toUpperCase());
    await clickText(fpage, 'form button', 'Spara');
    await waitForText(fpage, 'Du loggar in med ditt nya namn');
    await waitForText(fpage, 'nytt namn går att välja');
    assert.equal((await api('/api/auth/login', null, { method: 'POST', body: { username: fName, password: 'E2e-Passw0rd!x' } })).status, 200, 'log in with the new name');
    const again = await api('/api/me/username', F.token, { method: 'PATCH', body: { username: `${fName}2` } });
    assert.ok(again.status === 429 && again.body.nextChangeAt, 'once a week (the weekly lock, not the rate limit)');
    // Det gamla namnet hålls åt sin ägare under veckan: ingen annan kan ta det…
    assert.equal((await api('/api/me/username', G.token, { method: 'PATCH', body: { username: F.name } })).status, 409, 'the old name is held for its owner');
    // …och ägaren kan ångra: tillbaka till det gamla namnet med knappen.
    await clickText(fpage, 'button', `Byt tillbaka till ${F.name}`);
    await fpage.waitForFunction((n) => document.querySelector('h1')?.textContent === n, {}, F.name);
    await fctx.close();
    setNeedsUsernameInLocalDb(G.name);
    const nctx = await browser.createBrowserContext();
    const npage = await nctx.newPage();
    current = npage;
    watch(npage);
    await npage.setViewport({ width: 390, height: 844 });
    await npage.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await login(npage, G);
    await waitForText(npage, 'Välj ditt användarnamn');
    const gInput = await npage.waitForSelector('.modal input[autocomplete="username"]');
    assert.equal(await gInput.evaluate((el) => el.value), G.name, 'the suggested name is filled in');
    await clearInput(npage, gInput);
    await gInput.type(gName);
    await clickText(npage, '.modal button', 'Spara');
    await npage.waitForFunction(() => !document.querySelector('.modal'));
    const gMe = (await api('/api/auth/me', G.token)).body.user;
    assert.deepEqual([gMe.username, gMe.needsUsername, gMe.usernameChangedAt], [gName, false, null], 'the first choice does not start the weekly lock');
    await nctx.close();
    current = page;
    ok('usernames: change it under Profil (rules checked, log in with the new name, once a week); a new Google account picks one on first login');

    // ── Kompisar: blockera och häv ──────────────────────────────────────────
    await page.goto(`${BASE}/kompisar`, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'Blockera');
    await page.waitForSelector('.modal');
    await clickText(page, '.modal button', 'Blockera');
    await waitForText(page, 'är blockerad');
    assert.equal((await api('/api/study/units?allTerms=1', B.token)).body.units.length, 3, 'the friend\'s copies are theirs — a block takes nothing back');
    await clickText(page, 'details summary', 'Blockerade');
    await clickText(page, 'button', 'Häv blockering');
    await waitForText(page, 'är hävd');
    ok('Kompisar: block (the friend keeps the copies they got) and unblock');

    // ── utloggning: nästa elev på samma dator hamnar inte på den förras sida ──
    await page.goto(`${BASE}/kompisar`, { waitUntil: 'networkidle0' });
    await page.click('button[aria-label="Visa meny"]');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickText(page, '.nav-drawer button', 'Logga ut')]);
    assert.equal(new URL(page.url()).pathname, '/login');
    await login(page, B);
    await pause(1500);
    assert.equal(new URL(page.url()).pathname, '/lists', 'the next person starts on their own lists, not on the last page of the one who logged out');
    ok('after "Logga ut", the next person to log in starts on their own lists');

    assert.deepEqual(errors, [], `no page errors:\n${errors.join('\n')}`);
    ok('no errors in any page');
  } catch (err) {
    if (current && !current.isClosed()) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const file = path.join(SHOTS, 'failure.png');
      await current.screenshot({ path: file, fullPage: true }).catch(() => {});
      console.error(`  screenshot: ${file}`);
    }
    if (errors.length) console.error(`  page errors:\n  ${errors.join('\n  ')}`);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    let leftover = 0;
    for (const u of users) {
      const r = await api('/api/me', u.token, { method: 'DELETE' }).catch(() => ({ status: 0 }));
      if (r.status !== 200) leftover += 1;
    }
    if (leftover) console.warn(`  ! ${leftover} throwaway user(s) could not be deleted`);
    else console.log('  · deleted throwaway users');
  }
  console.log('All good.');
}

main().catch((err) => {
  console.error('\nBROWSER E2E FAILED:', err.message);
  process.exit(1);
});
