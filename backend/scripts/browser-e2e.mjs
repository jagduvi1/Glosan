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
import { e2e, grantFeatureInLocalDb } from './lib/e2e.mjs';

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
  // 401 från refresh-proben och 404 för favicon är väntade — inga fel i appen.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console ${page.url()}: ${m.text()}`);
  });
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, selector, text) {
  for (const h of await page.$$(selector)) {
    if ((await h.evaluate((el) => el.textContent)).includes(text)) {
      await h.click();
      return;
    }
  }
  throw new Error(`no ${selector} containing "${text}" on ${page.url()}`);
}
const waitForText = (page, text, timeout = 10000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

async function login(page, user) {
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
  try {
    // ── data via API/MCP ────────────────────────────────────────────────────
    const A = await signUp('bra');
    const B = await signUp('brb');
    grantFeatureInLocalDb(A.name, 'study');
    const claude = await connectMcp(A.token);
    for (const [subject, title] of [['matematik', 'Procent'], ['matematik', 'Förändringsfaktor'], ['historia', 'Industriella revolutionen']]) {
      const u = await call(claude, 'create_study_unit', { subject, grade_year: 8, title });
      await call(claude, 'add_flashcards', { unit_id: u.data.unit_id, cards: [{ front: 'Fråga', back: 'Svar' }] });
    }
    await claude.close();
    const code = (await api('/api/me/invite-codes', A.token, { method: 'POST' })).body.inviteCode.code;
    assert.ok((await api('/api/me/friends/by-code', B.token, { method: 'POST', body: { code } })).status < 300);
    const list = await api('/api/lists', A.token, { method: 'POST', body: { title: 'Djur', sourceLang: 'sv', targetLang: 'en' } });
    const listId = list.body.list._id;
    await api(`/api/lists/${listId}/glosor`, A.token, { method: 'POST', body: { source: 'häst', target: 'horse' } });
    ok('two users (friends), three Plugga units, a list with one word');

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []
    });
    page = await browser.newPage();
    watch(page);
    await page.setViewport({ width: 390, height: 844 });

    // ── inloggning: tillbaka dit man skulle ─────────────────────────────────
    await page.goto(`${BASE}/plugga`, { waitUntil: 'networkidle0' });
    assert.equal(new URL(page.url()).pathname, '/login');
    await login(page, A);
    assert.equal(new URL(page.url()).pathname, '/plugga', 'back on the Plugga page after logging in');
    await page.goto(`${BASE}/finns-inte`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'vilse');
    ok('a Plugga page sends you to login and back again; unknown pages show the 404 page');

    // ── Plugga: Dela flera områden ──────────────────────────────────────────
    await page.goto(`${BASE}/plugga`, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'Dela');
    await page.waitForSelector('#share-study-title');
    await waitForText(page, 'Vad vill du dela?');
    await clickText(page, '.modal button', 'Välj alla');
    await page.$$eval('.modal label', (labels, name) => labels.forEach((l) => { if (l.textContent.includes(name)) l.click(); }), B.name);
    await clickText(page, '.modal button', 'Dela 3');
    await waitForText(page, 'Klart!');
    const bUnits = (await api('/api/study/units?allTerms=1', B.token)).body.units;
    assert.equal(bUnits.length, 3, 'the friend has all three units');
    await clickText(page, '.modal button[role="tab"]', 'QR-kod');
    await page.type('.modal input.inp', 'Allt inför provet');
    await clickText(page, '.modal button', 'Skapa QR-kod för 3');
    await page.waitForSelector('.modal img[alt^="QR"]');
    const shareUrl = await page.$eval('.modal', (m) => (m.textContent.match(/https?:\/\/[^\s]+\/p\/[A-Z0-9]+/) || [])[0]);
    assert.ok(shareUrl, 'the QR card shows the link');
    ok('Plugga: Dela picks your units, shares all three with a friend and makes ONE QR code for them');

    // ── länken för någon utan konto ─────────────────────────────────────────
    const guest = await browser.createBrowserContext();
    const gpage = await guest.newPage();
    watch(gpage);
    await gpage.setViewport({ width: 390, height: 844 });
    await gpage.goto(shareUrl.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle0' });
    await waitForText(gpage, 'Allt inför provet');
    await waitForText(gpage, 'delar 3 områden med dig');
    await waitForText(gpage, 'Skapa konto');
    await guest.close();
    ok('the link shows its name and all three units to someone without an account, with "Skapa konto"');

    // ── ämnessidan ──────────────────────────────────────────────────────────
    await page.goto(`${BASE}/plugga/amne/matematik`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Förändringsfaktor');
    await clickText(page, 'button', 'Dela');
    await page.waitForSelector('#share-study-title');
    await page.keyboard.press('Escape');
    ok('the subject page has its own Dela button');

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
    for (const p of [`/lists`, `/lists/${listId}/flashcards`, `/lists/${listId}/galge`, `/lists/${listId}/ordfall`, '/profile', '/integritet']) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0' });
      await pause(200);
    }
    ok('lists, flashcards, galge, ordfall, profile and the privacy page load');

    // ── Kompisar: blockera och häv ──────────────────────────────────────────
    await page.goto(`${BASE}/kompisar`, { waitUntil: 'networkidle0' });
    await clickText(page, 'button', 'Blockera');
    await page.waitForSelector('.modal');
    await clickText(page, '.modal button', 'Blockera');
    await waitForText(page, 'är blockerad');
    assert.equal((await api('/api/study/units?allTerms=1', B.token)).body.units.length, 0, 'blocking takes the shared units away');
    await page.$$eval('details summary', (s) => s.forEach((x) => x.click()));
    await clickText(page, 'button', 'Häv blockering');
    await waitForText(page, 'är hävd');
    ok('Kompisar: block (the friend loses the shared units) and unblock');

    assert.deepEqual(errors, [], `no page errors:\n${errors.join('\n')}`);
    ok('no errors in any page');
  } catch (err) {
    if (page) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const file = path.join(SHOTS, 'failure.png');
      await page.screenshot({ path: file, fullPage: true }).catch(() => {});
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
    if (!leftover) console.log('  · deleted throwaway users');
  }
  console.log('All good.');
}

main().catch((err) => {
  console.error('\nBROWSER E2E FAILED:', err.message);
  process.exit(1);
});
