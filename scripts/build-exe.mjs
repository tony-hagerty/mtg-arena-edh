// Builds release/ArenaEDH.exe: one portable Windows program with no installer.
//
// It's a Node "single executable application" (https://nodejs.org/api/single-executable-applications.html):
// a copy of Windows' node.exe with the launcher (launcher/, bundled into one file) and the
// built game (dist/) embedded in it. Run `npm run build` first; `npm run build:exe` does both.
// Works on Windows and Linux. Off Windows it downloads node.exe for this same Node version
// from nodejs.org once, checks it against nodejs.org's published checksum, and keeps it in
// dist-exe/.
//
//   node scripts/build-exe.mjs                 the .exe
//   node scripts/build-exe.mjs --bundle-only   only dist-exe/launcher.cjs, to run with Node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const work = join(root, 'dist-exe');
const exe = join(root, 'release', 'ArenaEDH.exe');

// Fixed by Node for every single executable application.
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

if (!existsSync(join(dist, 'index.html'))) fail('No dist/index.html: run `npm run build` first.');
mkdirSync(work, { recursive: true });

// 1. The launcher, bundled into one CommonJS file (what Node embeds).
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: join(root, 'launcher', 'main.ts'),
    outDir: work,
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rolldownOptions: { output: { format: 'cjs', entryFileNames: 'launcher.cjs' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
const bundle = join(work, 'launcher.cjs');
console.log(`Bundled ${relative(root, bundle)}`);
if (process.argv.includes('--bundle-only')) process.exit(0);

// 2. The blob Node embeds: the launcher, plus every file in dist/ as an asset keyed by
// its path there. files.json lists them, since Node 22 can't list an exe's assets.
const files = walk(dist).map((f) => relative(dist, f).split(sep).join('/'));
writeFileSync(join(work, 'files.json'), JSON.stringify(files));
const assets = { 'files.json': join(work, 'files.json') };
for (const f of files) assets[f] = join(dist, f);
const blob = join(work, 'sea.blob');
writeFileSync(
  join(work, 'sea-config.json'),
  JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
    // Both off, so a blob made on Linux runs on Windows.
    useSnapshot: false,
    useCodeCache: false,
    assets,
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', join(work, 'sea-config.json')], { stdio: 'inherit' });

// 3. Windows' node.exe for this Node version, unsigned, with the blob injected. Node's
// signature can't cover our changes, and Windows trusts a broken signature less than none.
mkdirSync(dirname(exe), { recursive: true });
rmSync(exe, { force: true });
writeFileSync(exe, unsigned(readFileSync(await windowsNode())));
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: FUSE });

// 4. Mark it a windowed program, so double-clicking it opens no console window.
const image = readFileSync(exe);
windowed(image);
writeFileSync(exe, image);

const mb = (image.length / 1024 / 1024).toFixed(0);
console.log(`Built ${relative(root, exe)} (${mb} MB, Node ${process.version}, ${files.length} game files)`);

/** node.exe for win-x64 at this Node version: this one on Windows, else downloaded and checked. */
async function windowsNode() {
  if (process.platform === 'win32' && process.arch === 'x64') return process.execPath;
  const cached = join(work, `node-${process.version}-win-x64.exe`);
  if (existsSync(cached)) return cached;
  const base = `https://nodejs.org/dist/${process.version}`;
  console.log(`Downloading ${base}/win-x64/node.exe`);
  const sums = await (await get(`${base}/SHASUMS256.txt`)).text();
  const want = /^([0-9a-f]{64})\s+win-x64\/node\.exe$/m.exec(sums)?.[1];
  if (!want) fail(`No checksum for win-x64/node.exe in ${base}/SHASUMS256.txt`);
  const body = Buffer.from(await (await get(`${base}/win-x64/node.exe`)).arrayBuffer());
  const got = createHash('sha256').update(body).digest('hex');
  if (got !== want) fail(`node.exe checksum mismatch: expected ${want}, got ${got}`);
  writeFileSync(cached, body);
  return cached;
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) fail(`${url}: ${res.status} ${res.statusText}`);
  return res;
}

/** Where a Windows program's optional header starts (see `windowed`). */
function optionalHeader(image) {
  const pe = image.readUInt32LE(0x3c);
  if (image.toString('latin1', pe, pe + 4) !== 'PE\0\0') fail('node.exe is not a Windows program');
  return pe + 24;
}

/**
 * A copy of a Windows program without its Authenticode signature. The signature is the
 * certificate table: data directory 4 (from offset 112 in a 64-bit optional header) gives
 * its file offset and size, and it sits at the end of the file.
 */
function unsigned(image) {
  const opt = optionalHeader(image);
  if (image.readUInt16LE(opt) !== 0x20b) fail('node.exe is not a 64-bit Windows program');
  const entry = opt + 112 + 4 * 8;
  const offset = image.readUInt32LE(entry);
  const size = image.readUInt32LE(entry + 4);
  if (size === 0) return image;
  if (offset + size !== image.length) fail("node.exe's signature isn't at the end of the file");
  const out = Buffer.from(image.subarray(0, offset));
  out.writeUInt32LE(0, entry);
  out.writeUInt32LE(0, entry + 4);
  return out;
}

/**
 * Sets a Windows program's subsystem to "windows GUI" (2) instead of "console" (3). The
 * subsystem is a field in the PE header: e_lfanew at 0x3C points to "PE\0\0", the optional
 * header starts 24 bytes after that, and Subsystem is 68 bytes into it (PE32 and PE32+).
 */
function windowed(image) {
  const at = optionalHeader(image) + 68;
  if (image.readUInt16LE(at) !== 3) fail(`Unexpected subsystem ${image.readUInt16LE(at)} in node.exe`);
  image.writeUInt16LE(2, at);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
