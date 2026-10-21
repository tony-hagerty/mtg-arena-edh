/*
  Your hand's curve and its scroll pills, worked out from the screen's size in rem. Pure
  maths, no React: tests/table-layout.test.ts checks it. The numbers come from the approved
  mockup (1440 × 900 px, so a rem is 7.5 px there). Where the cards on the table go is
  three/layout3d.ts and three/board.ts.
*/

/*
  Your hand follows a curve: flat out of the left edge of the screen, then bending down into
  the bottom edge. The card centres sit on it, evenly spaced along it, each turned to the
  curve's direction under it. Points here are in rem: x from the screen's left edge, y up
  from its bottom edge. Angles are degrees clockwise, as CSS turns things.
*/

/** A hand card's size in rem. Keep in step with `.hand-slot` (and HAND_W in Card.tsx). */
export const HAND_W = 15;
export const HAND_H = HAND_W * 1.4;

/** The curve as drawn on the mockup: two cubic Béziers in its px (900 px high, y down). */
const CURVE_PX = [
  [
    [-43, 821.4],
    [-43, 821.4],
    [-7.7, 818],
    [43.2, 818],
  ],
  [
    [43.2, 818],
    [138.8, 818],
    [289.3, 829.8],
    [365.1, 897.8],
  ],
];
const PX = 7.5;
const MOCK_H = 900;

export interface Pt {
  x: number;
  y: number;
}

/** The curve sampled finely, with the distance along it at each sample. */
const samples: Pt[] = CURVE_PX.flatMap((b) =>
  Array.from({ length: 201 }, (_, j) => {
    const u = j / 200;
    const v = 1 - u;
    const w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
    const px = w.reduce((n, k, i) => n + k * b[i][0], 0);
    const py = w.reduce((n, k, i) => n + k * b[i][1], 0);
    return { x: px / PX, y: (MOCK_H - py) / PX };
  }),
);
const acc = samples.reduce<number[]>((a, p, i) => [...a, i ? a[i - 1] + Math.hypot(p.x - samples[i - 1].x, p.y - samples[i - 1].y) : 0], []);
/** The curve's length in rem. */
export const CURVE_LEN = acc[acc.length - 1];

/** Which way the curve runs from `p` to `q`, in degrees clockwise (y is up, so it is flipped). */
const heading = (p: Pt, q: Pt) => (Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI;
const unit = (p: Pt, q: Pt) => {
  const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
};
const startDir = unit(samples[0], samples[10]);
const endDir = unit(samples[samples.length - 11], samples[samples.length - 1]);

/**
 * The point `s` rem along the curve and its heading. Past either end the curve carries
 * straight on, so cards scrolled out of the hand slide off along it.
 */
export function along(s: number): Pt & { th: number } {
  const th = (d: Pt) => (Math.atan2(-d.y, d.x) * 180) / Math.PI;
  if (s <= 0) return { x: samples[0].x + startDir.x * s, y: samples[0].y + startDir.y * s, th: th(startDir) };
  if (s >= CURVE_LEN) {
    const e = samples[samples.length - 1];
    const k = s - CURVE_LEN;
    return { x: e.x + endDir.x * k, y: e.y + endDir.y * k, th: th(endDir) };
  }
  let j = 1;
  while (j < acc.length - 1 && (acc[j] < s || acc[j] === acc[j - 1])) j++;
  const p = samples[j - 1];
  const q = samples[j];
  const f = acc[j] > acc[j - 1] ? (s - acc[j - 1]) / (acc[j] - acc[j - 1]) : 0;
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, th: heading(p, q) };
}

/** The whole curve drops so that the bottom quarter of each card is below the screen: its flat part carries the card centres a quarter of a card above the bottom edge. */
export const HAND_DROP = HAND_H / 4 - (MOCK_H - 818) / PX;
/** How many cards show at once; a bigger hand scrolls. */
export const HAND_VISIBLE = 7;
/** How far left of its centre a hand card at curve distance `s` reaches, turned to the curve there, in rem. */
const reachLeft = (s: number) => {
  const t = (along(s).th * Math.PI) / 180;
  return (HAND_W / 2) * Math.abs(Math.cos(t)) + (HAND_H / 2) * Math.abs(Math.sin(t));
};
/** Where the first card's centre is along the curve: just far enough in that its left edge touches the screen's left edge (found by halving). */
const S0 = (() => {
  let lo = 0;
  let hi = CURVE_LEN / 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (along(mid).x - reachLeft(mid) < 0) lo = mid;
    else hi = mid;
  }
  return hi;
})();
/** Where the last card's centre is: where the dropped curve reaches the bottom edge, so its corner still shows. */
const S_END = (() => {
  const i = samples.findIndex((p) => p.y + HAND_DROP <= 0);
  return i < 0 ? CURVE_LEN - 24 / PX : acc[i];
})();
/** The distance along the curve from one card to the next. */
export const HAND_STEP = (S_END - S0) / (HAND_VISIBLE - 1);

/** The centre and turn of the card in `slot` (0 the first one showing; less, or HAND_VISIBLE and more, past the ends). */
export function handSlot(slot: number): Pt & { th: number } {
  const p = along(S0 + slot * HAND_STEP);
  return { x: p.x, y: p.y + HAND_DROP, th: p.th };
}

/** The first card that shows: `start`, kept so the window never runs past either end of a hand of `total`. */
export const handWindow = (start: number, total: number) => Math.max(0, Math.min(total - HAND_VISIBLE, start));

/**
 * The scroll pills over a hand that doesn't fit: two short arcs along the curve, lifted above
 * the card tops, either side of the middle of the cards that show. Each is a list of points,
 * with a double chevron in its middle pointing its way.
 *
 * In rem: how thick a pill is (`.pill-rim`'s stroke in styles.css), how far its middle runs
 * above the card tops (clear of the mana costs riding on them, `.hand-cost`, which reach
 * 1.35rem above, with room to spare), the space between the two, and each one's length.
 */
export const PILL = { thick: 1.9, above: 3.2, gap: 1.7, len: 5.4 };
const PILL_LIFT = HAND_H / 2 + PILL.above;

/** The point `s` rem along the curve, lifted above the card tops, and its heading. */
function lifted(s: number): Pt & { th: number } {
  const p = along(s);
  const t = (p.th * Math.PI) / 180;
  // Straight up from the card: the curve's normal toward the top of the screen.
  return { x: p.x + Math.sin(t) * PILL_LIFT, y: p.y + HAND_DROP + Math.cos(t) * PILL_LIFT, th: p.th };
}

const arc = (a: number, b: number) => Array.from({ length: 31 }, (_, k) => lifted(a + ((b - a) * k) / 30));

/** Two marks a little apart along the curve, each a "<" (dir -1) or ">" (dir 1) turned to the curve under it, as polylines. */
function chevron(s: number, dir: -1 | 1): Pt[][] {
  const mark = (at: number) => {
    const q = lifted(at);
    const t = (q.th * Math.PI) / 180;
    // Offsets along (x) and across (y, up) the curve, in rem.
    const pt = (x: number, y: number) => ({ x: q.x + x * Math.cos(t) + y * Math.sin(t), y: q.y - x * Math.sin(t) + y * Math.cos(t) });
    return [pt(-0.24 * dir, 0.48), pt(0.2 * dir, 0), pt(-0.24 * dir, -0.48)];
  };
  return [mark(s - 0.4), mark(s + 0.4)];
}

export function handPills() {
  const mid = S0 + ((HAND_VISIBLE - 1) * HAND_STEP) / 2;
  // The round caps reach half a pill's thickness past each end, so the ends sit that much further apart.
  const gap = PILL.gap / 2 + PILL.thick / 2;
  const left = { a: mid - gap - PILL.len, b: mid - gap };
  const right = { a: mid + gap, b: mid + gap + PILL.len };
  return {
    left: { path: arc(left.a, left.b), chevron: chevron((left.a + left.b) / 2, -1) },
    right: { path: arc(right.a, right.b), chevron: chevron((right.a + right.b) / 2, 1) },
  };
}
