# Research: converting the app to Flutter

Question: should Arena EDH become a Flutter app? The motive is visual polish: a real 3D
scene, with the camera moving, cards as solid objects, and an environment around the table
(trees, rocks, architecture), which the current CSS-transform table can't do well.

**Status: research only. Nothing in the app changes. The recommendation is at the end.**

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
