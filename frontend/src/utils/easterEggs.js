// Spårar vilka påskägg användaren har upptäckt. Lagras lokalt i webbläsaren.
// Modalen som visas via 7 klick på footern läser detta för att markera
// vilka som hittats vs. inte (utan att avslöja exakt hur man triggar dem).

const STORAGE_KEY = 'glo-eggs-found';

export const EGGS = [
  { id: 'konami',       label: 'Det gamla fusket',     hint: 'En klassisk kombo från arkadhallen.' },
  { id: 'logo-outfit',  label: 'Glos garderob',        hint: 'Klicka, klicka, klicka …' },
  { id: 'season',       label: 'Helgdags-Glo',         hint: 'Kolla in när det är fest.' },
  { id: 'night-mode',   label: 'Nattuggla',            hint: 'Plugga när du borde sova.' },
  { id: 'snake-master', label: 'Orm-mästare',          hint: 'Slingra dig 50 rätt i rad.' },
  { id: 'zero-hug',     label: 'En kram av Glo',       hint: 'Ibland blir det inget rätt.' },
  { id: 'streak-7',     label: 'Veckans hjälte',       hint: 'Sju dagar i sträck.' },
  { id: 'streak-30',    label: 'Gyllene flamma',       hint: 'En hel månad utan att missa.' },
  { id: 'fika-rain',    label: 'Fikadags!',            hint: 'Vad är en svensk lärobok utan kaffe?' },
  { id: 'glo-title',    label: 'Hej Glo!',             hint: 'En lista uppkallad efter mascoten.' },
  { id: 'xp-burst',     label: 'Stjärnregn',           hint: 'En XP-pille tål en del klick.' },
  { id: 'abracadabra',  label: 'Trollformeln',         hint: 'Skriv det magiska ordet.' },
  { id: 'footer-list',  label: 'Påskägg-listan',       hint: 'Du tittar på den just nu.' }
];

export function getFoundEggs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function markEggFound(id) {
  if (!id) return;
  try {
    const cur = getFoundEggs();
    if (cur.has(id)) return;
    cur.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(cur)));
  } catch {
    /* ignore */
  }
}
