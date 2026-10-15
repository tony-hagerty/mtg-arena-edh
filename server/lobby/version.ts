// Which build of the program this is. Two programs at one table must be the same build:
// cards are scripted and the engine runs on the host, but each window checks its moves
// with its own copy, and a saved game is read by whichever program resumes it.
// scripts/build-exe.mjs sets it from package.json's version and a hash of the source, so
// any change to the code makes a new one. Run from source (the dev server, tests) it's 'dev'.
declare const __ARENA_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __ARENA_VERSION__ === 'string' ? __ARENA_VERSION__ : 'dev';
