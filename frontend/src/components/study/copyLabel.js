// "från A", "från A och B", "från A, B och C" — vilka en kopia i Plugga kom
// från: den som gav den, och de som delat det med en sedan (det nya från dem).
export function copyFromLabel(unit) {
  const names = [unit.copiedFrom, ...(unit.alsoFrom || [])].filter(Boolean);
  if (!names.length) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}`;
  return `från ${list}`;
}
