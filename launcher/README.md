# The Windows program (ArenaEDH.exe)

One portable `.exe` with no installer. Double-click it and the game opens in its own
window; close the window and the program quits. Windows 10 and 11 only.

```bash
npm run build:exe   # build the game, then release/ArenaEDH.exe
npm run launcher    # run the launcher from source against dist/ (run `npm run build` first)
```

`build:exe` works on Windows and Linux. Off Windows it downloads `node.exe` for the same
Node version from nodejs.org the first time, checks its published SHA-256, and keeps it in
`dist-exe/`.

## How it works

- **The .exe** is a Node [single executable application](https://nodejs.org/api/single-executable-applications.html):
  Windows' `node.exe` with the launcher (this folder, bundled into one file) and every file
  of `dist/` embedded in it. `scripts/build-exe.mjs` makes it, removes Node's signature
  (it can't cover our changes), and marks the program windowed so no console window opens.
- **Its icon and name:** the build swaps Node's icon for `src/ui/icon.svg`, drawn as PNGs
  from 16 to 256 px, and Node's name and version in the file's details for Arena EDH's
  (what Explorer's Properties and Task Manager show). The game window uses the same SVG
  as its icon.
- **The window** is Microsoft Edge in app mode (`--app`): the normal title bar, no tabs or
  address bar. Edge gets its own profile folder (`--user-data-dir`) beside the .exe, so it
  is separate from the user's everyday Edge.
- **The server** listens on `127.0.0.1:47180` only, so nothing outside the computer can
  reach it and Windows' firewall doesn't ask. It always tries that port first, because
  the browser keeps saved decks and settings per address; it tries the next 9 if another
  program holds it.
- **Quitting:** when the Edge it started exits (its last window closed). If Edge handed the
  window to one already running on that profile, it quits once no game page has been open
  for 3 seconds instead. Each page holds a connection to `/__launcher/alive`, added to
  `index.html` as it's served.
- **The game** runs in the launcher (`server/game/`, see "The game server" in
  `docs/rules-coverage.md`); the page streams its seat's view from `/api/game/`. Any
  request other than a GET must carry this server's own address as its `Origin`, so
  another web page open in the browser can't start games or send moves.
- **Hosting a table** also listens for friends on TCP port 47190 (or the next free one) on
  every network, so the first time, Windows Firewall asks whether to allow it. Friends
  need it allowed; "Private networks" is enough for friends on the same Wi-Fi. Leaving
  the table, or quitting, closes the router's forward.
- **Double-clicking it again** while it runs opens another window on the running copy.
- **Alt+Enter** toggles fullscreen (`src/ui/fullscreen.ts`). F11 works too.

## The data folder

Everything lives in `ArenaEDH-data/` beside the .exe, so the program and its folder can
move to another folder or a USB stick together.

| Path             | What                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| `edge/`          | Edge's profile. Saved decks, settings and fetched cards are in its storage |
| `launcher.log`   | What the launcher did, and any error, the game window's too. Cleared once it passes 1 MB |
| `saves/`         | A copy of each table game this player is in, to carry on if the host goes |

`launcher/paths.ts` also names `cards/` for the game server to come.

### When the game crashes

The game window sends each error it hits to the program (`POST /api/game/error`,
`server/game/report.ts`), which writes one line to `launcher.log`:

```
2026-10-19T12:00:00.000Z Page error (render) 0.2.1-ab12cd turn 7 main1: Error: Unknown card: Wizard | at cardData (...) | at SpellFlash (...)
```

`render` is an error while drawing the screen (the window shows the error screen, with
Copy Details and Leave to Menu); `error` and `rejection` are any other error nothing
caught. Ask whoever saw a crash for `ArenaEDH-data/launcher.log` beside their `ArenaEDH.exe`,
or for what Copy Details put on their clipboard. Under `npm run dev` the same lines go to
the dev server's terminal, and a page opened from disk only shows the error screen.

## First run

Windows shows "Windows protected your PC" the first time anyone runs a downloaded .exe
that isn't signed. Click **More info**, then **Run anyway**, once.

## Flags (development)

- `--no-window`: only serve the game and print its address.
- `--browser <path>`: open the window in that Chromium-based browser instead of Edge.
- `--dist <folder>`: serve that folder instead of `dist/` (from source only).
