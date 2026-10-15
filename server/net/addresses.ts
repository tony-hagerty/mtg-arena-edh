/// <reference types="node" />
// IPv4 addresses on the host's side of the router: what kind an address is, which router
// is this computer's default gateway, and which of this computer's addresses faces it.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

/**
 * - `public`: reachable from the internet.
 * - `private`: a home or office network (RFC 1918: 10/8, 172.16/12, 192.168/16).
 * - `shared`: carrier-grade NAT, an address the internet provider shares among many homes
 *   (RFC 6598: 100.64.0.0/10).
 * - `loopback`, `link-local`: this computer only, or a network with no router.
 * - `invalid`: not an IPv4 address, or one no host can have (0/8, multicast, reserved).
 */
export type AddressKind = 'public' | 'private' | 'shared' | 'loopback' | 'link-local' | 'invalid';

/** An IPv4 address as an unsigned 32-bit number. */
export function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

export function intToIpv4(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
}

/** Whether `ip` is inside `base/bits`. */
export function inSubnet(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

const RANGES: [string, number, AddressKind][] = [
  ['0.0.0.0', 8, 'invalid'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'shared'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local'],
  ['172.16.0.0', 12, 'private'],
  ['192.168.0.0', 16, 'private'],
  ['224.0.0.0', 3, 'invalid'], // multicast, reserved and broadcast
];

export function addressKind(ip: string): AddressKind {
  if (!isIPv4(ip)) return 'invalid';
  return RANGES.find(([base, bits]) => inSubnet(ip, base, bits))?.[2] ?? 'public';
}

/** A default route: the router's address and this computer's address on that network. */
export interface Gateway {
  gateway: string;
  /** This computer's address toward the router, when the route table names it. */
  local: string | null;
}

/**
 * Reads the output of Windows' `route print -4 0.0.0.0`. The default routes are the lines
 * "0.0.0.0  0.0.0.0  <gateway>  <interface>  <metric>"; the lowest metric wins, as it does
 * for Windows. The column headers are translated on non-English Windows, so they are ignored.
 */
export function parseWindowsRoutes(text: string): Gateway | null {
  const routes = [...text.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+(\S+)\s+(\d+)\s*$/gm)]
    .filter((m) => isIPv4(m[1]))
    .map((m) => ({ gateway: m[1], local: isIPv4(m[2]) ? m[2] : null, metric: Number(m[3]) }))
    .sort((a, b) => a.metric - b.metric);
  return routes.length ? { gateway: routes[0].gateway, local: routes[0].local } : null;
}

/** Reads Linux's /proc/net/route, where addresses are little-endian hex. Used by the tests' machines. */
export function parseLinuxRoutes(text: string): Gateway | null {
  const RTF_GATEWAY = 2;
  const routes = text
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length >= 8 && f[1] === '00000000' && (parseInt(f[3], 16) & RTF_GATEWAY) !== 0)
    .map((f) => ({ gateway: intToIpv4(Buffer.from(f[2], 'hex').readUInt32LE(0)), metric: Number(f[6]) }))
    .sort((a, b) => a.metric - b.metric);
  return routes.length ? { gateway: routes[0].gateway, local: null } : null;
}

/** This computer's default gateway, the home router in nearly every home, or null if there's none. */
export async function defaultGateway(): Promise<Gateway | null> {
  try {
    if (process.platform === 'win32') {
      const out = await new Promise<string>((resolve, reject) =>
        execFile('route', ['print', '-4', '0.0.0.0'], { windowsHide: true, timeout: 5000 }, (err, stdout) =>
          err ? reject(err) : resolve(stdout),
        ),
      );
      return parseWindowsRoutes(out);
    }
    if (process.platform === 'linux') return parseLinuxRoutes(await readFile('/proc/net/route', 'utf8'));
  } catch {
    // No route table to read: treated as no gateway.
  }
  return null;
}

type Interfaces = ReturnType<typeof networkInterfaces>;

/** This computer's IPv4 address on the same network as `gateway`, or null if no interface shares it. */
export function localAddressFor(gateway: string, interfaces: Interfaces = networkInterfaces()): string | null {
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const bits = a.cidr ? Number(a.cidr.split('/')[1]) : maskBits(a.netmask);
      if (inSubnet(a.address, gateway, bits)) return a.address;
    }
  }
  return null;
}

function maskBits(netmask: string): number {
  return ipv4ToInt(netmask).toString(2).replace(/0+$/, '').length;
}
