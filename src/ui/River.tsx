import { useTableSize } from './camera';

/*
  A slow river in a loose arc around your seat: up out of the bottom-left corner, under the
  side seat, across the middle band of the table a little way above your mat, and down into
  the bottom-right corner. It meanders, and a few rocks break its surface. Drawn under
  everything on the table, in rem (the SVG's viewBox is the table in rem), so it follows the
  seats wherever the window puts them (styles.css: .seat-left, .me-mat).
*/

/** The arc's ends sit this far below the bottom edge, at the corners. */
const CORNER = 6;
/**
 * It rises this much across the middle: to 60rem up, six above your mat's top (54.4rem),
 * and it is past the side seats' bottom (38rem up) by 19rem in from the edge.
 */
const RISE = 66;

interface Pt {
  x: number;
  y: number;
}

/** A channel: its centre line, the normal there, and how wide it is, all for t in 0..1. */
interface Channel {
  at: (t: number) => Pt;
  width: (t: number) => number;
  /** The samples along it. */
  steps: number;
  seed: number;
}

/** A small deterministic random sequence (mulberry32), so the rocks stay put between redraws. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
/** A gentle meander: two sine waves, in rem. */
const meander = (t: number, a1: number, k1: number, p1: number, a2: number, k2: number, p2: number) => a1 * Math.sin(TAU * k1 * t + p1) + a2 * Math.sin(TAU * k2 * t + p2);
/** The width wanders too, by a quarter either way. */
const wander = (base: number, t: number, p: number) => base * (1 + 0.22 * Math.sin(TAU * 3.7 * t + p) + 0.12 * Math.sin(TAU * 8.3 * t + p * 1.7));

/** The river for a table `w` by `h` rem: one channel, left edge to right edge. */
function channels(w: number, h: number): Channel[] {
  return [
    {
      at: (t) => {
        const x = -6 + t * (w + 12);
        // The arc: steep out of the corners and flat across (the shallow root), so it clears your mat's corners as well as its middle.
        const arc = RISE * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, x / w))), 0.4);
        return { x, y: h + CORNER - arc + meander(t, 1.8, 3.1, 1.3, 0.8, 7.3, 4.0) };
      },
      width: (t) => wander(5.2, t, 2.2),
      steps: Math.round(w + 12),
      seed: 37,
    },
  ];
}

const fmt = (n: number) => n.toFixed(2);

/** The channel's samples: centre, unit normal and width at each step. */
function sample(c: Channel) {
  const out: { p: Pt; n: Pt; w: number }[] = [];
  for (let i = 0; i <= c.steps; i++) {
    const t = i / c.steps;
    const p = c.at(t);
    const a = c.at(Math.max(0, t - 0.002));
    const b = c.at(Math.min(1, t + 0.002));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ p, n: { x: -dy / len, y: dx / len }, w: c.width(t) });
  }
  return out;
}

/** A bank's own raggedness: it is cut around stones, so each side wanders a little on its own. */
const ragged = (i: number, phase: number) => 1 + 0.16 * Math.sin(i * 0.9 + phase) + 0.1 * Math.sin(i * 2.3 + phase * 3) + 0.06 * Math.sin(i * 5.1 + phase * 7);

/** The water's outline: one bank forward, the other back, each ragged in its own way. */
function bankPath(s: ReturnType<typeof sample>, seed: number) {
  const left = s.map(({ p, n, w }, i) => {
    const k = (w / 2) * ragged(i, seed);
    return `${fmt(p.x + n.x * k)} ${fmt(p.y + n.y * k)}`;
  });
  const right = s
    .map(({ p, n, w }, i) => {
      const k = (w / 2) * ragged(i, seed + 2.4);
      return `${fmt(p.x - n.x * k)} ${fmt(p.y - n.y * k)}`;
    })
    .reverse();
  return `M${left.join('L')}L${right.join('L')}Z`;
}

/** A line along the channel, `f` of the way from the centre to a bank (-0.5..0.5). */
const linePath = (s: ReturnType<typeof sample>, f: number) => `M${s.map(({ p, n, w }) => `${fmt(p.x + n.x * w * f)} ${fmt(p.y + n.y * w * f)}`).join('L')}`;

/** Rocks breaking the surface: a few per channel, off the centre line. */
function rocks(s: ReturnType<typeof sample>, seed: number) {
  const rnd = random(seed);
  const out: { x: number; y: number; rx: number; ry: number; turn: number }[] = [];
  const count = Math.max(2, Math.round(s.length / 28));
  for (let i = 0; i < count; i++) {
    const { p, n, w } = s[Math.floor((rnd() * 0.8 + 0.1) * s.length)];
    const f = (rnd() - 0.5) * 0.6;
    out.push({ x: p.x + n.x * w * f, y: p.y + n.y * w * f, rx: 0.45 + rnd() * 0.5, ry: 0.35 + rnd() * 0.35, turn: rnd() * 180 });
  }
  return out;
}

/**
 * Everything drawn for a table `w` by `h` rem. Nothing while the table has no size: the root
 * font-size follows the window (styles.css), so a window with no size gives 0 rem and a width and
 * height of 0, NaN or Infinity, and the channel would have no samples for the rocks to sit on.
 * It draws normally again once the window has a size.
 */
export function riverGeometry(w: number, h: number) {
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return [];
  return channels(w, h).map((c) => {
    const s = sample(c);
    return { bank: bankPath(s, c.seed), centre: linePath(s, 0), flows: [linePath(s, -0.28), linePath(s, 0.03), linePath(s, 0.3)], rocks: rocks(s, c.seed) };
  });
}

export function River() {
  // The table, not the screen: it is taller (camera.ts), and the arc keeps its place from the bottom edge.
  const { w, h } = useTableSize();
  const parts = riverGeometry(w, h);
  if (parts.length === 0) return null;
  return (
    <svg className="river" viewBox={`0 0 ${fmt(w)} ${fmt(h)}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id="river-soft" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.5" />
        </filter>
        {/*
          The water, its edge, its shadow and its lip are all cut from one shape: the outline,
          closed (grown then shrunk) so the ragged banks keep no pinched notches. The water sits
          below the stone: a shadow falls inside the banks, deeper under the upper and left ones as the
          light comes from the upper left, and a thin lit lip runs just outside the lower and
          right ones.
        */}
        <filter id="river-inset" filterUnits="userSpaceOnUse" x="-10" y="-10" width={fmt(w + 20)} height={fmt(h + 20)}>
          <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="grown" />
          <feMorphology in="grown" operator="erode" radius="1" result="shape" />
          <feFlood floodColor="rgb(14, 40, 62)" floodOpacity="0.86" />
          <feComposite in2="shape" operator="in" result="water" />
          <feMorphology in="shape" operator="erode" radius="0.3" result="core" />
          <feComposite in="shape" in2="core" operator="out" result="edgeMask" />
          <feFlood floodColor="#03060a" floodOpacity="0.85" />
          <feComposite in2="edgeMask" operator="in" result="edge" />
          <feGaussianBlur in="shape" stdDeviation="0.9" result="blur" />
          <feOffset in="blur" dx="0.45" dy="0.55" result="shifted" />
          <feComposite in="shape" in2="shifted" operator="arithmetic" k2="1" k3="-1" result="innerMask" />
          <feFlood floodColor="#000" floodOpacity="0.8" />
          <feComposite in2="innerMask" operator="in" result="inner" />
          <feOffset in="shape" dx="0.3" dy="0.35" result="forward" />
          <feComposite in="forward" in2="shape" operator="out" result="lipMask" />
          <feFlood floodColor="#cfe6ff" floodOpacity="0.1" />
          <feComposite in2="lipMask" operator="in" result="lip" />
          <feMerge>
            <feMergeNode in="lip" />
            <feMergeNode in="water" />
            <feMergeNode in="edge" />
            <feMergeNode in="inner" />
          </feMerge>
        </filter>
      </defs>
      {/* The channel's outline: only its shape matters, the filter paints it. */}
      <g className="river-water" filter="url(#river-inset)">
        {parts.map((c, i) => (
          <path key={i} d={c.bank} />
        ))}
      </g>
      {/* Deeper water down the middle, and the current: dashes sliding along three lines at different paces. */}
      <g className="river-deep">
        {parts.map((c, i) => (
          <path key={i} d={c.centre} />
        ))}
      </g>
      <g className="river-current">
        {parts.map((c, i) =>
          c.flows.map((d, j) => <path key={`${i}-${j}`} d={d} style={{ '--dur': `${7 + j * 2.5 + i}s`, animationDelay: `${-j * 2.1 - i}s` } as React.CSSProperties} />),
        )}
      </g>
      <g className="river-rocks">
        {parts.map((c, i) =>
          c.rocks.map((r, j) => (
            <g key={`${i}-${j}`} transform={`translate(${fmt(r.x)} ${fmt(r.y)}) rotate(${fmt(r.turn)})`}>
              {/* The water piling against the rock's upstream side. */}
              <ellipse className="river-wake" cx="0" cy="0" rx={fmt(r.rx + 0.35)} ry={fmt(r.ry + 0.3)} />
              <ellipse cx="0" cy="0" rx={fmt(r.rx)} ry={fmt(r.ry)} />
            </g>
          )),
        )}
      </g>
    </svg>
  );
}
