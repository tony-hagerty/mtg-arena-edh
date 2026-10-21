# Research: converting the app to Flutter

Question: should Arena EDH become a Flutter app? The motive is visual polish: a real 3D
scene, with the camera moving, cards as solid objects, and an environment around the table
(trees, rocks, architecture), which the current CSS-transform table can't do well.

**Status: researched, and the spike at the end is built and is now the usual table, drawn
in 3D (src/ui/three/; `?table=css` draws the CSS one). What it showed is under "The spike,
built".**

Dates and versions below are as of October 2026. Flutter and the 3D libraries move fast,
so re-check before acting on a version number.

## Short answer

The visuals you want need a 3D renderer. They don't need Flutter. The browser already has
one (WebGL 2 and WebGPU, driven by Three.js or Babylon.js), and that renderer is the same
one Flutter itself uses on the web. Moving to Flutter means rewriting the whole program in
Dart (roughly 44,000 lines of app and server code plus 17,000 lines of tests) to get a 3D
engine that is pre-1.0, while putting a real 3D scene behind the current React app is a
rewrite of about 2,000 lines of table-drawing code with everything else untouched.

Recommended: keep the TypeScript engine, store, server and launcher, and replace the table
(`Board.tsx`, `Card.tsx`, `Flights.tsx`, `camera.ts`, `table-layout.ts`) with a Three.js
scene through React Three Fiber. Spike it first (plan at the end).

## What the app is made of

Lines of non-generated TypeScript, so the sizes are honest:

| Layer | Lines | Moves to Flutter how |
| --- | --- | --- |
| `src/engine/` + `src/cards/` (rules, scripts, Oracle parser, bots) | 23,148 | Rewritten by hand in Dart |
| `src/ui/` (React, Zustand, CSS) | 8,981 | Rewritten in Flutter widgets |
| `server/` (game server, lobby, TLS, NAT-PMP, UPnP) | 2,904 | Rewritten in Dart, or kept as a Node sidecar |
| `launcher/` (Node single executable + Edge app window) | 530 | Replaced by Flutter's native Windows build |
| `tests/` (rules, cards, UI flow, bot-vs-bot games) | 17,157 | Rewritten in Dart tests |

Three things make the port larger than the line count suggests:

- **The engine depends on Immer.** `applyAction` works on structural sharing (unchanged
  parts of the old game are reused by the new one) and frozen objects, and the bots copy
  the game and try moves on the copies. Dart has no Immer. The nearest patterns (`freezed`
  or `built_value` code generation, or hand-written `copyWith`) are a different style, and
  the state types in `types.ts` (1,799 lines) would be rewritten around them, not
  translated.
- **The Oracle text parser** (`oracle.ts`, 3,134 lines, 258 regular expressions) is
  TypeScript-shaped. Dart's `RegExp` is close to JavaScript's, so the patterns mostly
  carry over, but the parser is scored against a 600-card corpus and every difference would
  show up as a card that used to parse and now doesn't.
- **There is no TypeScript-to-Dart translator.** `ts2dart` was built to port Angular 2 and
  is abandoned; the `ts2dart` on pub.dev converts type declarations for calling JavaScript
  from Dart, not application code. A port is a hand rewrite.

The bots would also need re-tuning: they are a search over copies of the game, and the
bot-vs-bot games in `tests/simulation/` are the check that every engine change keeps them
working. Those games are the last thing a port could run.

## Checking the premise

> "the level of visual polish I want isn't something I can realistically do with
> traditional web tooling and still have good performance"

This is true of what the app does now and false of what the browser can do.

**What the app does now** is CSS: `.table` is a DOM element leaned over by a 10°
`rotateX` under a `perspective`, cards are `<div>`s with images, and `camera.ts` redoes the
same projection in maths so layout can place things on the leaning plane. That is the
ceiling of "traditional web tooling". There is no depth buffer, no lighting, no meshes,
and every card is a separate layer the compositor has to manage. `docs/plans/performance.md`
measured where that costs.

**What the browser can do** is run a 3D renderer on the GPU. WebGL 2 has been universal
for years, and WebGPU (the modern, lower-overhead API) is now on by default in Chrome and
Edge, Safari 26 and Firefox on Windows. Three.js's `WebGPURenderer` uses WebGPU when the
browser has it and falls back to WebGL 2 by itself, and the Three.js manual says the old
`WebGLRenderer` will get no larger new features because the project's focus is now the
WebGPU renderer. Babylon.js has had WebGPU in its core since 8.0.

Two points matter for this app in particular:

- **The Windows build already runs in Chromium.** `ArenaEDH.exe` opens Microsoft Edge in
  app mode. A Three.js scene there gets Edge's hardware-accelerated WebGPU or WebGL 2,
  the same GPU path a native app would use. Nothing about the launcher changes.
- **Flutter on the web is the same renderer.** `flutter_scene` on the web "ships its own
  WebGL2 backend", and Flutter web draws everything onto a canvas (CanvasKit or skwasm).
  A Flutter web build would be a WebGL 2 app, exactly what a Three.js build is, with a
  bigger download.

A Commander table is a small scene for a GPU: four seats of cards (a crowded board is
about 90 cards), a table mesh, a handful of environment models and lights. Three.js
renders scenes a hundred times larger at 60 frames per second in a browser. Performance is
not the thing that separates the options below. The things that separate them are how
much code is rewritten, how mature the 3D engine is, and what tooling you get for
environment art.

## Flutter in 2026

The good news is real. Flutter's 3D story is far further along than it was a year ago:

- **Impeller** (Flutter's own GPU renderer) became the default on Windows, Linux and
  macOS in Flutter 3.47 (August 2026). On Windows it reaches the GPU through ANGLE (OpenGL
  ES translated to Direct3D 11), not Vulkan.
- **Flutter GPU** is the low-level 3D API on top of Impeller. It is still opt-in: it needs
  a flag or a per-platform setting (`Info.plist`, `AndroidManifest.xml`, or the Windows and
  Linux runner code), and shipping a Windows release needs 3.47.1.
- **`flutter_scene`** (Brandon DeRosier, on the Flutter team) is the 3D engine on Flutter
  GPU, now on stable: version 0.24.3, requiring Flutter 3.47 or newer. It has glTF import,
  PBR materials, directional, point, spot and area lights, cascaded shadows, skinned and
  morph-target animation, raycast picking, Flutter widgets embedded on 3D surfaces, and
  post-processing (bloom, depth of field, fog, god rays, screen-space reflections, colour
  grading, FXAA/SMAA/TAA). A scene editor is "in active development". On the web it runs
  on its own WebGL 2 backend without flags.

The caveats are also real:

- `flutter_scene` is "pre-1.0 and evolving quickly" and warns that "minor releases can
  carry breaking changes". It has had about 1,800 commits in the past year, which is both
  a sign of life and a sign of churn. Three.js is 16 years old.
- Flutter web is a canvas: no DOM, so no text selection, browser find, translation, or
  the usual accessibility tree. The WebAssembly path (skwasm) is Chromium-only in practice;
  Firefox and Safari get CanvasKit from the same build, and multi-threaded skwasm could
  crash on text-heavy frames in 3.47.x. The "single `index.html` anyone can double-click"
  distribution in the README gets much larger and loses the plain-HTML fallbacks
  (`TextCard.tsx`, the paste screen as real form fields).
- Everything the project has built for the web workflow is gone: Vite's instant reload
  (Flutter has hot reload, but not on web for release builds), Vitest, the Playwright
  profiling harness, the Scryfall cache in IndexedDB, Web Audio synthesis in `synth.ts`
  and `music.ts` (Flutter would need an audio library and a different synthesis approach),
  the `motion` animations, and all 4,389 lines of CSS.
- The multiplayer server is Node: TLS identity, NAT-PMP, UPnP, join codes, saved games.
  Either it stays as a Node process the Flutter app starts (two runtimes in one install,
  which is what the launcher avoids today) or it is ported too.

What Flutter would buy that the browser can't: a true native Windows binary without
Edge, and one codebase for iOS and Android apps if phones and tablets are a goal. Both
are worth something. Neither is the stated reason for the move, and a Three.js table also
runs in mobile browsers.

## The options

### A. Keep React and TypeScript; put the table in Three.js (recommended)

Replace the CSS table with a WebGL/WebGPU scene drawn by Three.js through
[React Three Fiber](https://github.com/pmndrs/react-three-fiber) (R3F), which lets you
write a Three.js scene as React components and runs its render loop outside React's
update cycle. Zustand is the state library R3F's own guides recommend, and it is what
`store.ts` already uses.

What changes:

- `Board.tsx`, `Card.tsx`, `Flights.tsx`, `camera.ts`, `table-layout.ts` (about 2,000
  lines) become a scene: a table mesh, cards as thin textured boxes (Scryfall images as
  textures, a real card back), seats laid out in world units instead of rem, a
  `PerspectiveCamera` where `camera.ts` now fakes one, flights as object animation,
  environment glTF models around the table, lights and shadows.
- Hover, drag and click come from R3F's pointer events on meshes (it does the raycasting).
  `view.ts` (1,795 lines of highlights, prompts, buttons and click handlers) keeps its
  job: it already works in terms of card ids and seats, not DOM positions.
- The HUD, menu, picker, log and paste screen stay as DOM over the canvas. This is normal
  practice (R3F's `drei` library has `Html` for widgets anchored to 3D points) and keeps
  the text crisp and selectable.

What stays exactly as it is: engine, cards, bots, store, server, launcher, tests, the
casting-flow tests in `tests/view.test.ts`, the single-file build, the Windows .exe.

Risks: text drawn inside the 3D scene (the `TextCard` fallback when an image doesn't
load) needs a canvas texture or an `Html` overlay; the hand's curve and scroll pills and
the opponents' fans are redone in 3D; the camera projection that the tests in
`tests/camera.test.ts` and `tests/table-layout.test.ts` check goes away with the code it
checks. It can ship behind a toggle beside the CSS table until it is better.

Effort: weeks, incremental, in the stack you already know.

### B. Flutter with `flutter_scene`: the full rewrite

Everything in the table above is rewritten in Dart. The 3D side is the newest and least
proven piece of a rewrite that is otherwise all risk and no new features for months. The
tests are the last thing to come back, so the period with no safety net is the whole port.

Effort: months of full-time work before the game plays as well as it does today. Choose
this only if native mobile apps are a goal in themselves, and even then see C.

### C. Flutter shell with the TypeScript engine inside it

Keep `src/engine/` and `src/cards/` as a JavaScript bundle and run it in Flutter through
an embedded JavaScript engine (`jsf` or `fjs`, both QuickJS-based; `flutter_js` is the older
one its successors call outdated and prone to build errors). Dart sends actions over the
bridge and reads back each seat's view as JSON.

Problems: QuickJS is an interpreter, many times slower than V8, and the bots are the
CPU-heavy part of this program (they copy the game and try moves; `profile-game.mjs`
measures it). Every game change crosses a serialisation boundary. Debugging spans two
languages and two runtimes. On the web the bundle would run in the browser's own engine,
so it would behave differently per platform. This keeps the engine but gives up most of
what makes Flutter pleasant.

### D. Godot 4 with GodotJS

A real game engine with a scene editor for placing trees, rocks and buildings, and
[GodotJS](https://github.com/godotjs/GodotJS) to keep the TypeScript engine (it supports
V8, QuickJS, JavaScriptCore and the browser's engine, with TypeScript as a first-class
workflow). GodotJS calls itself "essentially usable but still under testing" and is built
into the engine from source, not a drop-in extension. Godot's web export is WebGL 2 only
(no WebGPU, and C# can't export to the web at all, a warning about how non-core scripting
languages fare there). The multiplayer server stays Node or is ported to GDScript.

This is the strongest alternative to A if the environment art becomes the main job, since
an editor beats placing glTF models in code. It is also a bigger change of workflow than
Flutter, with a less mature scripting bridge.

### E. Babylon.js instead of Three.js

Same shape as A. Babylon.js is "batteries included" (physics, a material editor, an
inspector) and has had WebGPU in its core since 8.0; Three.js is leaner, far more widely
used, and has the mature React layer. For a card table that needs no physics, R3F's
React integration decides it. Worth keeping in mind if the scene grows into something
with simulation in it.

## Recommendation and spike

Do A, and prove it with a one to two week spike before committing:

1. Add `three`, `@react-three/fiber` and `@react-three/drei`. Mount a `Canvas` in
   `GameScreen.tsx` behind a toggle (`?table=3d`) that replaces `.table` only.
2. Draw the table mesh, one glTF environment prop (a tree or a pillar from a free pack) and
   two seats of cards as textured boxes from the live store, lit with one directional light
   and shadows. Use `WebGPURenderer` so WebGL 2 is the fallback, not the target.
3. Wire hover (full-size preview), click (select and target through `view.ts`) and drag
   from hand to table, so the casting flow in `tests/view.test.ts` still passes unchanged.
4. Animate one flight (a card from hand to the battlefield) and one camera move (a slow
   push in at start of combat).
5. Measure with the harness from `docs/plans/performance.md`: a crowded four-player board
   with bots at 4×, frame times and long tasks, in the production build in Edge app mode.

Decide on these:

- Does the spike reach the look you want? If not, no runtime change will; it is an art
  and lighting question, and both Flutter and Three.js would face it the same way.
- Is the crowded board at 60 frames per second in Edge on a mid-range laptop? Expect yes.
- Did `tests/view.test.ts` keep passing with the 3D board driving the same store? That is
  the proof that the engine, store and view are untouched.

Revisit Flutter only if a native mobile app becomes a goal in itself. Even then, do the
Three.js table first: the engine, store and view it leaves alone are exactly the parts a
later port would share across platforms, and the mobile browsers run the same scene.

## The spike, built

`?table=3d` (docs/how-to-play.md) swaps `.table` in `GameScreen.tsx` for `src/ui/three/Table3D.tsx`.
Nothing else changes: the engine, the store, `view.ts`, the HUD, the hand, the portraits and
piles, the server and the launcher are as they were, and `tests/view.test.ts` passes unchanged.
The 3D code is a separate chunk (about 410 kB gzipped, Three.js mostly) that only the toggle
downloads.

What is in it:

- **The scene.** Three.js through React Three Fiber, drawn by Three's `WebGPURenderer`,
  which runs on WebGL 2 where there is no WebGPU (headless Chromium here; `?gl=webgl`
  forces it). Trees, rocks and lantern pillars, a hemisphere light and a shadow-casting
  "moon", fog past the table. `?quality=low` drops shadows and high-DPI drawing.
- **The floor** (`floor.ts`) is worked out pixel by pixel after the CSS table's: dark slate
  flagstones packed like bubbles (discs thrown biggest first, each stone the ground its
  disc claims against its neighbours, a power diagram, cut to a polygon of five to seven
  corners), darker joints with moss and grass, small blue mushrooms that glow (an emissive
  map), a slow mottle, and the light falling off toward the edges (vertex colours). Each
  stone has a bevelled, rough, slightly tilted surface in a height field, turned into a
  normal map, with a roughness map, so the moon catches their edges. The maps are one
  192 × 96 rem picture (4096 px across, about 21 px a rem) that wraps without a seam, laid
  on in rem from the table's middle, so the screen never shows it twice. The full size takes
  a second or two, so a worker (`floor.worker.ts`) draws it while a 512 px version of the
  same stones, drawn at once, stands in.
- **The camera** starts exactly where the CSS table's perspective puts the viewer
  (`baseCamera` in layout3d.ts: the same TILT and DEPTH as camera.ts, with an off-centre
  projection whose axis is the bottom of the screen), so the seats' rows land where
  `table-layout.ts` designed them under the same portraits and piles. It pushes in slowly
  while combat is on and comes back after.
- **The cards** are thin boxes with the Scryfall image on top (Scryfall allows cross-origin
  use, so WebGL may read it) and a drawn back underneath, at a real card's proportions, in
  the same piles and rows as the CSS tiles (`layoutSeat`, which reuses `seatBox`, `seatScale`
  and `rowGap`; tested in tests/layout3d.test.ts). They cast shadows, turn when tapped, lift
  toward the middle when attacking or blocking, glow in the same colours, and ease to their
  places when the layout moves them. Auras and Equipment fan out behind their host, which
  rests on them.
- **Resting on the floor.** A card is 0.12 rem thick, so the moon's shadow of it is a
  sliver: its shadow biases are kept well under that (a bigger normal bias moved the shadow
  off the card, which then seemed to float), and its shadow camera is fitted to the table
  (`moonShadowBox`) with a 4096 map, about 0.05 rem a texel. What shows a card lying on the
  stone is a soft dark under each pile's bottom card (`shadowTexture`), the occlusion a
  flat card makes all around it; it spreads and fades as the card rises.
- **Hover, click and drag** go through the same handlers as the tiles: raycast picking on
  the meshes calls `clickPermanent` and sets `hover`; the pile badge calls `clickGroup`; the
  hand is the DOM hand, so dragging a card up still calls `playHandCard`.
- **Proxies.** Each card also has an empty div kept over it on the screen every frame
  (`useProxy`), taking no pointer events. It is the card's own size on the table, laid
  onto the card's four projected corners by a CSS `matrix3d` (a homography, `quadMatrix`
  in layout3d.ts, tested), so it leans with its seat, turns when the card is tapped and
  foreshortens with the table. It is what keeps the DOM-querying parts of the interface
  working unchanged: the preview beside the hovered card (`hover.el`), the attack and
  target arrows (`[data-card]`), Flights.tsx reading where a card leaving the table was,
  and `cardAt`, all through `getBoundingClientRect()`, which takes the transform. It also
  carries the badges (P/T, counters, summoning sickness, "x7"), so they are crisp DOM text
  over the canvas, turned and foreshortened with the card.
- **Flights in.** A card reaching the table flies from where it was on the screen (its hand
  slot, the stack, a pile, a portrait), captured before React redraws, and tokens pop up.
  A card leaving the table still flies as before, from its proxy.

What was checked, in headless Chromium driven by Playwright against the dev server, with
a four-player game played to turn 23 (20 permanents on the table):

- The board draws with every card's image, shadows and badges, all 20 proxies landed.
- Hovering a card on the table sets `hover` to its proxy and the preview appears beside it;
  leaving clears it.
- The attack arrow draws from the 3D attacker to the defender's portrait, and the camera
  pushes in during combat.
- `tests/view.test.ts`, `tests/camera.test.ts` and `tests/table-layout.test.ts` pass
  unchanged, `npm run build` passes.
- Playing a card from the hand (`playHandCard`, what letting go of a dragged card calls)
  logs the play, and the card flies from its hand slot onto the table, lands in the
  bottom seat's row with its image, and its proxy takes over. The drag gesture itself
  could not be driven: Motion's drag never starts under Playwright's synthetic pointer at
  these frame times, on the CSS table just the same, and the hand is that unchanged
  component.

**Frame times could not be measured meaningfully here.** This container has no GPU:
Chromium renders WebGL in software (SwiftShader), and a 1920 × 1080 frame of this scene
takes about 780 ms there, against tens of milliseconds for the CSS table. That number
says nothing about a real GPU, where a scene of 20 shadowed boxes and a few hundred
triangles of props is trivial. The measurement that matters is the one in the spike plan
above, step 5: open `?table=3d` in Edge on a mid-range laptop with a crowded four-player
board and bots at 4×, and read the frame times off the harness in
`docs/plans/performance.md`. Expect 60 frames per second; if it isn't, `frameloop="demand"`
(drawing only when something moves) and merging the cards into one instanced mesh are the
two standard fixes, neither of which changes the approach.

Since then:

- **An Arena camera.** The 3D table has its own lean and perspective (`TILT` 26°, `DEPTH`
  170 rem in camera.ts under `TABLE_3D`; the CSS table keeps 10° and 600). The far edge is
  about 0.6 of the near one. `seatBox` and everything else that projects through `camera()`
  follows, so the rows still land under the portraits.
- **The piles lie on the table.** Each seat's library and graveyard are 3D blocks as thick
  as the pile (`Pile3D`; a 99-card library stands 3.5 rem), on the seat's mat along its own
  edge (`seatArea`), all one size on the table so the far ones look smaller. The CSS pile
  itself (`Library`, `FaceUpPile` from Board.tsx) is laid over each one like a card's proxy
  (`ZoneProxy`). Its cards are hidden, and it keeps the icon, the count, the empty outline,
  the right-click that opens the zone, the hover, and the elements flights fly to and from.
- **Exile is the well.** Exile is shared (400.1), so the 3D table has one: a well with a
  low cobblestone wall where the paths cross, its dark water turning in a slow whirlpool,
  with the top card of each player's exile circling in it. Its proxy (`ExileProxy`) carries
  the count, the glow when something there can be cast, and one `[data-pile]` spot per
  player for the flights. A right-click on the water opens every player's exiled cards,
  under each owner's name (`ZoneViewer` with `pid` null).
- **Rounded corners.** A card is `cardGeometry` (geometry.ts): a rounded slab whose face
  image is laid over the whole rectangle, so the corners cut it as a card's are cut.
- **The tap mark.** A tapped card's proxy carries the tap symbol, as the CSS tile does.
- **The board.** A torch-lit stone hall for four (garden.ts, Garden.tsx, Hall.tsx). Each
  corner has a mat lying flat on the flagstones, all four one size on the table (the near
  two starting just above the bottom of the screen), and each is its seat's battlefield:
  the rows' box is the mat short of its piles, the well and what stands on the screen over
  it (`seatArea`), with no lean. The mats are dark materials with their borders worked in
  (leather, oak planks, slate, woven cloth); their albedo and normal maps are worked out per
  pixel. The floor is rectangular flagstones in rows with dirt in the joints (floor.ts).
  Dressed-stone walls with arched recesses run down both sides and across the far end, and
  torches in sconces either side of the play area flicker, with their lights. A dim, cool
  light from above casts the shadows.
- **Clicks on the board.** A click on a mat, the well or a path makes a burst there
  (effects.tsx: a splash, dust off the leather, wood chips, sparks off the slate, lint off
  the cloth, dust off the flagstones) with a soft sound (synth.ts). Only the bursts' own
  component draws again for it. The bursts' materials are pooled and built as the board
  first draws (`Warmup`): a new material's shader is the expensive part, and in headless
  Chromium's software renderer the first one stalled the scene for seconds.

What the spike leaves out, each a known piece of work rather than an open question:

- The CSS tiles' name bar, ability dot and the text-only fallback (`TextCard`) aren't
  drawn in 3D: a card without an image shows its frame colour under its badges.
- Phased-out, defeated and "mana source" styling is minimal (opacity only).
- The push-in is the only camera move. Any other (a seat's turn, a spell resolving) is a
  few lines in `Rig`.
- Environment props are procedural placeholders. A glTF model loads with
  `GLTFLoader` (or drei's `useGLTF`) in place of a `Tree`; the lighting and shadows already
  apply to it.
- The 3D table is the default since the spike; the CSS table is a URL toggle
  (`?table=css`), not a menu choice.

## Sources

Flutter:

- flutter_scene on pub.dev: https://pub.dev/packages/flutter_scene (version 0.24.3, Flutter
  3.47, platform notes, features, "pre-1.0 and evolving quickly")
- flutter_scene on GitHub: https://github.com/bdero/flutter_scene
- Flutter 3.47 makes Impeller the default on desktop:
  https://startdebugging.net/2026/08/flutter-3-47-impeller-default-renderer-on-desktop/
- Migrating a Windows or Linux desktop app to Impeller (ANGLE, no Vulkan path):
  https://startdebugging.net/de/2026/10/migrate-a-flutter-windows-or-linux-desktop-app-to-impeller/
- CanvasKit vs skwasm for Flutter web in 2026:
  https://startdebugging.net/2026/09/canvaskit-vs-skwasm-for-flutter-web-in-2026/
- Flutter 3.44 at Google I/O 2026 (HTML-in-Canvas origin trial):
  https://verygood.ventures/blog/google-io-2026/
- jsf (QuickJS in Flutter): https://pub.dev/packages/jsf ; fjs: https://pub.dev/packages/fjs
- ts2dart (abandoned Angular-era transpiler): https://github.com/vicb/ts2dart

Browser 3D:

- Three.js WebGPURenderer manual: https://threejs.org/manual/en/webgpurenderer
- Three.js WebGL to WebGPU migration guide (2026):
  https://www.utsubo.com/blog/webgpu-threejs-migration-guide
- WebGPU browser adoption 2026: https://svilenkovic.com/3d/webgpu-adoption-2026
- React Three Fiber: https://github.com/pmndrs/react-three-fiber
- Three.js vs Babylon.js vs PlayCanvas (2026):
  https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison
- Three.js vs Babylon.js (2026): https://app.cinevva.com/guides/threejs-vs-babylonjs

Godot:

- GodotJS: https://github.com/godotjs/GodotJS
- Godot web export (WebGL 2 only, no WebGPU, no C#):
  https://docs.godotengine.org/ja/stable/tutorials/export/exporting_for_web.html
