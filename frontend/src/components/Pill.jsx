export default function Pill({ children, bg, color, flat = false, style = {}, ...rest }) {
  const cls = `pill${flat ? ' pill-flat' : ''}`;
  const merged = { ...(bg && { background: bg }), ...(color && { color }), ...style };
  return <span className={cls} style={merged} {...rest}>{children}</span>;
}

export function StreakPill({ n }) {
  return (
    <Pill bg="var(--sky-soft)">
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
