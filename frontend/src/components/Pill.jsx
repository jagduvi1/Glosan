export default function Pill({ children, bg, color, flat = false, style = {}, ...rest }) {
  const cls = `pill${flat ? ' pill-flat' : ''}`;
  const merged = { ...(bg && { background: bg }), ...(color && { color }), ...style };
  return <span className={cls} style={merged} {...rest}>{children}</span>;
}

// `today` = har övat idag. Annars lever streaken bara till midnatt: flamman är
// grå tills man övat.
export function StreakPill({ n, today = true }) {
  // 30+ dagars streak → gyllene variant (påskägg)
  const isGolden = n >= 30;
  const days = `${n} ${n === 1 ? 'dag' : 'dagar'} i rad`;
  const title = !today ? `${days} — öva idag så håller streaken` : isGolden ? `${days} — gyllene streak!` : days;
  return (
    <Pill
      bg={isGolden ? 'var(--mustard)' : today ? 'var(--sky-soft)' : 'var(--paper-edge)'}
      style={isGolden ? { boxShadow: '2px 2px 0 0 var(--ink), 0 0 0 2px var(--mustard-soft)', color: 'var(--ink)', fontWeight: 800 } : undefined}
      title={title}
      aria-label={title}
    >
      <img
        src="/assets/flame-streak.svg"
        width="14"
        height="18"
        alt=""
        style={today ? undefined : { filter: 'grayscale(1)', opacity: 0.5 }}
      /> {n}
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
