// Nivåstegen i Plugga: ett pass som börjar på rätt nivå och klättrar.
//   • Start: den lägsta nivån (E → C → A) där eleven ännu inte kan 70 %.
//   • 3 rätt i rad → upp en nivå. 2 fel i rad → ner en nivå. "Nästan" står still.
//   • Tar en nivå slut på uppgifter går stegen till närmaste nivå som har kvar.
// Rena funktioner; passets tillstånd sparas i StudySession.ladder.

const LEVEL_ORDER = ['E', 'C', 'A'];
const STEP_UP_AFTER = 3;
const STEP_DOWN_AFTER = 2;
const START_MASTERY = 0.7;
const MASTERED_BOX = 3;

/** Startnivån utifrån hur mycket eleven redan kan på varje nivå. */
function startLevel(items, states) {
  const levels = LEVEL_ORDER.filter((l) => items.some((i) => i.level === l));
  if (!levels.length) return null;
  for (const l of levels) {
    const atLevel = items.filter((i) => i.level === l);
    const mastered = atLevel.filter((i) => (states.get(String(i._id))?.box || 0) >= MASTERED_BOX).length;
    if (mastered / atLevel.length < START_MASTERY) return l;
  }
  return levels[levels.length - 1];
}

/**
 * Nästa steg efter ett svar. `state`: { level, up, down, reached }.
 * Returnerar nytt tillstånd + moved: 'up' | 'down' | null. `levels` = nivåer
 * som finns i passet (i ordning), så stegen aldrig går till en tom nivå.
 */
function ladderStep(state, result, levels) {
  let { level, up = 0, down = 0, reached = level } = state;
  if (result === 'correct') { up += 1; down = 0; }
  else if (result === 'wrong') { down += 1; up = 0; }
  else { up = 0; }
  const i = levels.indexOf(level);
  let moved = null;
  if (up >= STEP_UP_AFTER && i >= 0 && i < levels.length - 1) {
    level = levels[i + 1];
    moved = 'up';
  } else if (down >= STEP_DOWN_AFTER && i > 0) {
    level = levels[i - 1];
    moved = 'down';
  }
  if (moved) { up = 0; down = 0; }
  if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(reached)) reached = level;
  return { level, up, down, reached, moved };
}

/**
 * Nästa uppgift: först från den aktuella nivån, annars närmaste nivå som har
 * kvar (uppåt före nedåt vid lika avstånd). Returnerar { itemId, level } eller null.
 */
function pickNext(pools, served, level) {
  const used = new Set((served || []).map(String));
  const next = (l) => (pools[l] || []).map(String).find((id) => !used.has(id));
  const i = LEVEL_ORDER.indexOf(level);
  const order = [level];
  for (let d = 1; d < LEVEL_ORDER.length; d++) {
    if (LEVEL_ORDER[i + d]) order.push(LEVEL_ORDER[i + d]);
    if (LEVEL_ORDER[i - d]) order.push(LEVEL_ORDER[i - d]);
  }
  for (const l of order) {
    const id = next(l);
    if (id) return { itemId: id, level: l };
  }
  return null;
}

module.exports = { LEVEL_ORDER, STEP_UP_AFTER, STEP_DOWN_AFTER, startLevel, ladderStep, pickNext };
