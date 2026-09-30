// Ritar Glosans app-ikoner från frontend/public/assets/logo-mark.svg, med
// varumärkets typsnitt (Lilita One, OFL, från frontend/src/assets/fonts)
// inbäddat — SVG:ns "G" är en <text>, och en fristående SVG får bara ett
// systemtypsnitt. Skriver till frontend/public/:
//   favicon.ico (16/32/48, PNG inuti ICO), icon-192.png, icon-512.png,
//   icon-maskable-512.png (papper-bakgrund, loggan inom säkerhetszonen),
//   apple-touch-icon.png (180, papper-bakgrund — iOS gör genomskinligt svart).
//
//   cd backend && node scripts/make-icons.mjs
//
// Ligger här för att puppeteer-core finns i backend (samma som browser-e2e.mjs).
// Chrome: CHROME_PATH, annars standardplatsen för Windows, macOS och Linux.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const OUT = path.join(FRONTEND, 'public');
const PAPER = '#FBF5E6';
const CHROME = process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}[process.platform] || '/usr/bin/google-chrome';

const svg = fs.readFileSync(path.join(OUT, 'assets/logo-mark.svg'), 'utf8');
const font = fs.readFileSync(path.join(FRONTEND, 'src/assets/fonts/lilita-one-latin.woff2')).toString('base64');

// ICO med PNG-komprimerade bilder (alla dagens webbläsare och Windows Vista+).
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size, e);
    header.writeUInt8(size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  // size: bildens sida i px; scale: hur stor del loggan tar; bg: null = genomskinlig.
  const render = async (size, scale = 1, bg = null) => {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const logo = Math.round(size * scale);
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: 'Lilita One'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
      html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${bg || 'transparent'}; overflow: hidden; }
      body { display: flex; align-items: center; justify-content: center; }
      svg { width: ${logo}px; height: ${logo}px; display: block; }
    </style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    if (!(await page.evaluate(() => document.fonts.check("60px 'Lilita One'")))) throw new Error('Lilita One did not load');
    return Buffer.from(await page.screenshot({ type: 'png', omitBackground: !bg }));
  };

  const small = [];
  for (const size of [16, 32, 48]) small.push({ size, data: await render(size) });
  const files = {
    'favicon.ico': ico(small),
    'icon-192.png': await render(192),
    'icon-512.png': await render(512),
    // Startskärmar beskär till cirkel/squircle — håll loggan väl inom 80 %-zonen.
    'icon-maskable-512.png': await render(512, 0.58, PAPER),
    'apple-touch-icon.png': await render(180, 0.8, PAPER)
  };
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), data);
    console.log(`  ${name.padEnd(24)} ${data.length} bytes`);
  }
} finally {
  await browser.close();
}
