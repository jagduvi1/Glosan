// Kapitel i Plugga: områden från samma bok och kapitel hör ihop och visas som
// en grupp på ämnessidan ("Kapitel 2 Tal — Plugg" och "— Diagnostiskt prov").
// Kapitlet tas från områdets källa (source.book + source.chapter); det som
// står efter ett tankstreck eller en parentes ("2 Tal — 2.1, 2.2") är avsnitt
// och räknas inte, så "2 Tal" och "2 Tal — 2.1" blir samma kapitel.

const SECTION_SPLIT = /\s+[—–-]\s+|\s*\(/;

export function chapterOf(unit) {
  const raw = (unit.source?.chapter || '').trim();
  const label = raw.split(SECTION_SPLIT)[0].trim();
  if (!label) return null;
  const book = (unit.source?.book || '').trim();
  return { key: `${book.toLowerCase()}|${label.toLowerCase()}`, label, book };
}

const codeNumber = (u) => Number(String(u.code || '').replace(/\D/g, '')) || 0;

/**
 * Dela upp en lista områden i block: kapitel med minst två områden blir en
 * grupp (i kodordning, MA2 före MA3), resten visas som vanligt. Blocken
 * kommer i den ordning deras första område hade i listan.
 */
export function groupByChapter(units) {
  const blocks = [];
  const byKey = new Map();
  for (const u of units) {
    const ch = chapterOf(u);
    if (!ch) {
      blocks.push({ kind: 'unit', unit: u });
      continue;
    }
    if (!byKey.has(ch.key)) {
      const block = { kind: 'chapter', ...ch, units: [] };
      byKey.set(ch.key, block);
      blocks.push(block);
    }
    byKey.get(ch.key).units.push(u);
  }
  return blocks.map((b) => {
    if (b.kind !== 'chapter') return b;
    if (b.units.length < 2) return { kind: 'unit', unit: b.units[0] };
    return { ...b, units: [...b.units].sort((x, y) => codeNumber(x) - codeNumber(y)) };
  });
}
