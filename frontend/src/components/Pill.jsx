export default function Pill({ children, bg, color, flat = false, style = {}, ...rest }) {
  const cls = `pill${flat ? ' pill-flat' : ''}`;
  const merged = { ...(bg && { background: bg }), ...(color && { color }), ...style };
  return <span className={cls} style={merged} {...rest}>{children}</span>;
}

export function StreakPill({ n }) {
  // 30+ dagars streak → gyllene variant (påskägg)
  const isGolden = n >= 30;
  return (
    <Pill
      bg={isGolden ? 'var(--mustard)' : 'var(--sky-soft)'}
      style={isGolden ? { boxShadow: '2px 2px 0 0 var(--ink), 0 0 0 2px var(--mustard-soft)', color: 'var(--ink)', fontWeight: 800 } : undefined}
      title={isGolden ? `${n} dagar i rad — gyllene streak!` : undefined}
    >
      <img src="/assets/flame-streak.svg" width="14" height="18" alt="" /> {n}
    </Pill>
  );
}

export function XpPill({ n }) {
  return (
    <Pill bg="var(--mustard-soft)">
      <img src="/assets/star-sticker.svg" width="14" height="14" alt="" /> {n} XP
    </Pill>
  );
}

export function LivesPill({ n }) {
  return (
    <Pill bg="var(--berry-soft)">
      <img src="/assets/heart-life.svg" width="14" height="14" alt="" /> {n}
    </Pill>
  );
}

// AI quota status. Hidden for unlimited plans; warns red when almost empty,
// nudges mustard when over 80 %, otherwise stays plum (Glo's accent colour).
export function QuotaPill({ used, limit }) {
  if (limit == null) return null;
  const left = Math.max(0, limit - used);
  const pct = limit > 0 ? used / limit : 0;
  const bg = left === 0
    ? 'var(--berry-soft)'
    : pct >= 0.8
      ? 'var(--mustard-soft)'
      : 'var(--plum-soft)';
  return (
    <Pill bg={bg} title={`${used} av ${limit} AI-anrop använda denna månad`}>
      <span aria-hidden="true">🤖</span> {left} kvar
    </Pill>
  );
}
