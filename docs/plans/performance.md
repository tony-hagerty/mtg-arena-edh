# Plan: performance

Goal: the table runs much slower than it should. Find where the time goes, in the browser
and in the engine, and fix what measurably helps without changing how the game looks or
plays.

**Status: done. The numbers after the fixes are under "After".**

## How it was measured

Everything below was measured in a Playwright-driven headless Chromium at 1920 × 1080,
against the production build (`vite build`, served with `vite preview`) and the dev server.
The harness drives the live store (`useStore`) to set up each scene, records a Chrome
trace per scene, and reports:

- frame times from a `requestAnimationFrame` loop (mean, p95, max, frames over 33 ms);
- main-thread time by category from the trace (script, style recalc, layout, paint) and
  raster time on the worker threads;
- long tasks (over 50 ms);
- React commits and store changes;
- a CDP CPU profile where the trace alone didn't say what the time was.

Scenes: an idle fresh table; an idle crowded 4-player board (88 tiles, 7 hand cards);
hovering the hand cards; dragging a hand card across the hand; the stack appearing and
resolving (five Lightning Bolts, held priority); cards flying between zones (three
creatures cast and resolved); four bots playing at 1× and 4× (the page drives the bots, as
the single-file build does); and bots at 4× through the dev server's game server.

**Caveat.** Headless Chromium here composites in software (SwiftShader). Compositing
full-screen layers costs tens of milliseconds a frame here and well under a millisecond
on a real GPU. So the frame rates below understate a real machine, and anything that is
compositor-bound here (the idle table, see below) is far cheaper for the user. The
main-thread, paint and raster numbers transfer. Where a cause is compositor-only it is
marked as such.

Engine timings are from Node, playing starter-deck seed 44 to the end (415 actions) and
timing `buildView()` on every tenth state.

## Baseline (production build)

| Scene | fps | p95 frame | max frame | long tasks | script | style | paint | raster |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle, fresh | 21.7 | 83 ms | 83 ms | 0 | 18 ms | 22 ms | 12 ms | 0 |
| idle, crowded | 18.5 | 83 ms | 117 ms | 0 | 15 ms | 20 ms | 7 ms | 0 |
| hover hand (10 s) | 18.8 | 83 ms | 117 ms | 0 | 109 ms | 84 ms | 82 ms | 557 ms |
| drag a card (19 s) | 15.2 | 83 ms | 600 ms | 8 (2.6 s) | 445 ms | 271 ms | 1596 ms | 6765 ms |
| stack (10 s) | 18.0 | 83 ms | 100 ms | 2 | 366 ms | 184 ms | 144 ms | 1933 ms |
| flights (8 s) | 18.8 | 83 ms | 133 ms | 2 | 230 ms | 130 ms | 144 ms | 1124 ms |
| bots 1× (28 s) | 19.6 | 83 ms | 117 ms | 1 | 749 ms | 418 ms | 474 ms | 3480 ms |
| bots 4× (31 s) | 15.1 | 83 ms | 183 ms | 12 (0.9 s) | 3443 ms | 1389 ms | 819 ms | 13166 ms |
| bots 4× via game server, dev (51 s) | 6.2 | 183 ms | 700 ms | 116 (13.5 s) | 10.7 s | 1.0 s | 0.5 s | 10.8 s |

Script, style, paint and raster are totals over the scene. The dev build adds React's
development overhead (StrictMode double render, `jsxDEV` debug tasks: 2.2 s of the 4×
scene's 13 s of samples), which is why the game-server row is so much worse; it is not a
server cost.

Engine (Node, seed 44):

| | mean | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| `botAction` | 6.7 ms | 1.3 ms | 31.7 ms | 72 ms |
| `applyBotAction` | 3.1 ms | 1.8 ms | 9.9 ms | 28 ms |
| `buildView`, watching | 0.01 ms | | | 0.3 ms |
| `buildView`, the human to act | 1.3 ms | 0.9 ms | 4.0 ms | 6.7 ms |
| `buildView`, crowded board, human to act (browser) | 6.7 ms | | | |

## Causes, ranked by cost

### 1. Every mouse press and release repaints the whole screen: 300 to 600 ms

`main.tsx` toggles `pressing` on `<html>` on every pointer down and up, to swap the
arrow for the pressed-in one. The class changes `--cursor`, which every element reads
(`* { cursor: var(--cursor) }`). A cursor change invalidates paint, and because it
changes on every element at once, every layer on the screen is repainted and
re-rastered: the stage background with its three SVG textures (`--grain`, `--mottle`,
`--stones`, two of them `feTurbulence` filters that are expensive to rasterize), the
3D table with all its tiles, the hand. In the drag scene that is a 400 to 600 ms stall at
each press and each release: 8 long tasks, 2.6 s, and 6.8 s of raster.

Checked by elimination: with the toggle suppressed, the drag scene has no long tasks and
1.4 s of raster; with the SVG textures removed, none either and 1.9 s. Pinning
`cursor` on the big elements, or moving the arrow to `html` and inheriting it, didn't
help: the invalidation happens wherever the cursor changes. A pressed arrow through
`:active` (with or without `:has()` to pick the deepest element) still stalled a drag: 22
long tasks, 1.5 s, because the browser churns the `:active` state while dragging. What
works is a class set from script on the one element under the pointer, skipping
floor-sized elements: no long tasks in the drag scene, and the click scene's raster the
same as with no pressed arrow at all (0.60 s against 0.66 s; pressing on the bare table
without the exclusion cost 2.3 s).

This is the one cost that is certainly as bad on a real machine: it is CPU raster of SVG
filters, and it runs twice per click.

### 2. The glow pulse keeps the compositor busy forever (compositor-only)

`.board::after` and `.table::after` each tile the mushrooms' glow over the whole screen
and animate their opacity without end. Two full-screen layers (one under the table's 3D
transform) are blended every frame, so the page never idles. Here that alone holds the
idle table at 19 fps: with the animation off it runs at the 60 fps cap, hover goes from
18 to 53 fps and 4× bots from 15 to 27.

Measured ways out, on the finished branch (idle / hover / drag / bots 4×):

| | idle | hover | drag | bots 4× |
| --- | --- | --- | --- | --- |
| both layers breathe, eased (before) | 18.5 fps | 17.1 | 16.3 | 15.5 |
| table breathes, corner glow static | 20.8 | 20.0 | 17.8 | 18.3 |
| corner glow breathes, table static | 23.6 | 21.6 | 20.4 | 20.9 |
| both breathe in 72 steps | 22.9 | 18.6 | | 17.9 |
| **both breathe in 24 steps (after, as built)** | **45.5** | **35.7** | **20.4** | 18.0 |
| neither breathes | 54.6 | 50.4 | 36.2 | 31.8 |

One breathing layer buys little: the cost is that anything animates every frame, not
the second layer. What works is a stepped timing function: the compositor skips frames
in which nothing changed, and `steps(24, jump-none)` over the 3.6 s pulse changes the
opacity every 150 ms by about 0.03, too small to see. The glow still goes from 0.3 to
1.0 and back; the breathing is linear in time rather than eased. On a real GPU each
blend is a fraction of a millisecond, so the gain there is mostly that the GPU idles
between steps. Bot play is unchanged because other things animate every frame anyway.

The reduced-motion rule (`* { animation: none }`) never matched these pseudo-elements,
so people who ask for less motion still got the pulse. Fixed in passing.

### 3. Motion animations re-raster the table every frame while bots play

At 4×, half the per-frame work is Motion animating tiles (the entrance spring, the
tapped turn, the attack lift), flights and the hand: with animations skipped the scene
runs at 36 fps instead of 27 (pulse off in both). The tiles are not compositor layers,
so every animated frame repaints them into the table's layer and re-rasters those
tiles. Giving `.tile` `will-change: transform` cuts the scene's raster from 21 s to
8.7 s with no change in what is drawn (the tiles already sit in the table's 3D layer, so
text is already grayscale-antialiased).

Motion's layout projection also measures every tile (`layoutId`) twice on every store
change, 190 `getBoundingClientRect` reads: 1.3 s of the 13 s profiled at 4× in dev.
That is left alone (see below).

### 4. A bot's thinking runs in the same frame as the board's render

`GameScreen` computes `botAction` in the effect that runs right after a game change
commits, before the timer that applies it. The think takes up to 72 ms (p95 32 ms) and
lands in the same task as React's commit, so the frame that shows the last move is
stretched by the next move's thinking. Moving the think into the timer costs nothing and
takes it off that frame.

### 5. React re-renders the board on every game change

`buildView` runs on every store change through `useMemo`, and the view is a context, so
every tile re-renders whenever the game changes. That is correct: a bot's move can change
any tile (an anthem, a tap, a glow). It costs about 8 ms a commit in production. Hovering,
dragging and other UI-only changes do **not** re-render the board (checked with render
counters; an earlier fiber-flag count suggested they did and was wrong, since fibers React
never revisits keep their mount-time flags). `Seat` and `SeatHud` are now `memo`, which
skips them, and so every tile, when `GameScreen` re-renders without the view changing (a
speed or settings change). `memo` on `Permanent` itself would skip nothing: it reads the
view context and re-renders with it anyway.

### 6. The engine

Not a cause. `applyBotAction` averages 3 ms, `buildView` is under 1 ms except on the
human's turn on a crowded board (7 ms, once per game change). Engine code does not appear
among the top CPU consumers while bots play.

### 7. Small things

- `ArrowLayer` rewrites every arrow's path on every animation frame while combat or
  targets are on screen, whether or not anything moved, which repaints the full-screen
  SVG every frame. Now it writes a path only when it changed.
- `Preview` and `Flights` read `getComputedStyle` per hover and per store change: a few
  microseconds each. Left alone.
- `seatBox` and `seatScale`: pure maths on four seats, microseconds. Left alone.
- The perspective table: flattening it (no `perspective`, no `rotateX`) takes the idle
  table from 19 to 33 fps here, compositor-only. It is the look; left alone.
- Style recalc runs 3 ms per commit on the crowded board (1.4 s of the 4× scene). Not
  chased.

## Fixes

1. **The pressed-in arrow on the pressed element only** (`main.tsx`, `styles.css`). The
   `pressing` class on `<html>` is gone; `pointerdown` puts `pressed` on the element
   under the pointer, unless it is floor-sized, and `pointerup` takes it off. What
   changes: the arrow presses in over the element that was pressed, and goes back to
   normal if the pointer is dragged off it while held. Dragging a hand card keeps the
   pointer on the card, so it stays pressed through the drag as before. Pressing on empty
   floor shows the normal arrow.
2. **Tiles as compositor layers** (`styles.css`): `.tile { will-change: transform }`.
3. **The bot thinks inside its timer** (`scheduleBot` in `ai.ts`, used by `GameScreen.tsx`
   and the game server's `host.ts`): the pause is measured from the game change as
   before; on the screen the think runs when the first timer fires, then the action is
   applied after whatever is left of the pause. An error in the think or the move is
   thrown again while drawing, so the error screen shows it rather than a frozen table.
4. **`memo` on `Seat` and `SeatHud`** (`Board.tsx`).
5. **`ArrowLayer` writes a path only when it changed** (`Hud.tsx`).
6. **Reduced motion covers pseudo-elements** (`styles.css`).
7. **The glow pulse in 24 steps** (`styles.css`): `steps(24, jump-none)` in place of
   `ease-in-out`, so the compositor draws about seven times a second while the table is
   idle instead of every frame.

## Tried and rejected

- Promoting the floor (`.table::before`) or the hand (`.hand`) to their own layers: no
  change to the drag scene, whose cost is the page-wide repaint, not those layers.
- Hiding the arrows SVG: 1.9 s to 1.4 s of raster in the stack scene, within noise for
  frame times. The cheap fix (write only on change) is kept; nothing more.
- Promoting flights, hand slots, opponents' card backs and life deltas as well as tiles:
  more long tasks and script than tiles alone, for the same frame rate.
- Replacing the SVG textures with flat colour: removes the click stall too, but changes
  the look. The cursor fix removes the repaints instead, so the textures stay.

## Left alone, as suggestions

- **Motion's layout projection on every tile.** `layoutId` on every `Permanent` makes
  Motion measure all 88 tiles on every game change. Memoizing each tile on what it draws
  (card identity, stats, glow, combat state) would skip the tiles that didn't change,
  both for React and for Motion. It touches what every tile reads from the view; worth
  doing, but not quietly.
- **Bot thinking off the main thread.** A Web Worker would take the 30 to 70 ms thinks off
  the UI thread entirely. The game server already does that for the Windows app.

## After

Same harness, same production build settings, the bot game seeded so both runs play the
same game. The frame rates barely move because the software compositor caps them (cause
2); the main-thread and raster columns are what changed.

| Scene | fps | p95 frame | max frame | long tasks | script | style | paint | raster |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| idle, crowded | 17.8 | 83 ms | 100 ms | 0 | 14 ms | 21 ms | 7 ms | 0 |
| hover hand (10 s) | 17.3 | 83 ms | 117 ms | 0 | 113 ms | 79 ms | 58 ms | 590 ms |
| drag a card (20 s) | 15.1 | 100 ms | **150 ms** (was 600) | **0** (was 8, 2.6 s) | 437 ms | 181 ms | **621 ms** (was 1596) | **1496 ms** (was 6765) |
| stack (10 s) | 16.9 | 83 ms | 117 ms | 2 | 359 ms | 174 ms | 137 ms | **1351 ms** (was 1933) |
| flights (8 s) | 16.2 | 83 ms | 117 ms | 1 | 212 ms | 132 ms | 133 ms | **634 ms** (was 1124) |
| bots 1×, seeded (28 s) | 17.9 | 83 ms | 117 ms | **0** (was 4) | 967 ms | 449 ms | 489 ms | **3257 ms** (was 4135) |
| bots 4×, seeded (30 s) | 14.5 | 100 ms | 150 ms | **4, 0.2 s** (was 19, 1.1 s) | 3945 ms | 1327 ms | 771 ms | **7765 ms** (was 12759) |

With the glow pulse switched off in both builds, so the compositor isn't the cap:

| Scene | before | after |
| --- | --- | --- |
| drag a card | 36 fps, max 483 ms, 7 long tasks (2.6 s), raster 6.4 s | 34 fps, max 83 ms, no long tasks, raster 1.4 s |
| hover hand | 53 fps | 49 fps |
| bots 4×, seeded | 27 fps, 35 frames over 50 ms, 14 long tasks (0.9 s), raster 18.9 s | 27 fps, 19 frames over 50 ms, 6 long tasks (0.4 s), raster 9.0 s |

Engine timings are unchanged (no engine logic changed). Screenshots of the same scenes
before and after, with the pulse held at one opacity so its phase doesn't differ, match
to antialiasing noise.
