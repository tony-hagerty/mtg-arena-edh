/// <reference types="node" />
// NAT-PMP (RFC 6886): a small UDP protocol for asking the home router for its public
// address and to forward a port. Apple routers and many others speak it; most of the rest
// speak UPnP (upnp.ts). The router listens on port 5351 at the default gateway's address.
import { createSocket } from 'node:dgram';

export const NAT_PMP_PORT = 5351;

/** RFC 6886 3.5 result codes, as plain reasons. */
const RESULTS: Record<number, string> = {
  1: 'the router does not support this NAT-PMP version',
  2: 'the router refused (port forwarding by programs may be turned off in its settings)',
  3: 'the router has no internet connection',
  4: 'the router has no ports left to forward',
  5: 'the router does not support this NAT-PMP request',
};

export class NatPmpError extends Error {
  constructor(
    message: string,
    /** The router's result code, or 0 when it never answered. */
    readonly code: number,
  ) {
    super(message);
    this.name = 'NatPmpError';
  }
}

export interface NatPmpOptions {
  /** The router's NAT-PMP port; only tests change it. */
  port?: number;
  /** Sends before giving up. RFC 6886 3.1 waits 250 ms, doubling each time; 4 tries take 3.75 s. */
  tries?: number;
  firstWaitMs?: number;
}

export type Protocol = 'tcp' | 'udp';

export function publicAddressRequest(): Buffer {
  return Buffer.from([0, 0]);
}

/** RFC 6886 3.3. Lifetime 0 with external port 0 removes the mapping (3.4). */
export function mapRequest(protocol: Protocol, internalPort: number, externalPort: number, lifetimeSec: number): Buffer {
  const b = Buffer.alloc(12);
  b[1] = protocol === 'udp' ? 1 : 2;
  b.writeUInt16BE(internalPort, 4);
  b.writeUInt16BE(externalPort, 6);
  b.writeUInt32BE(lifetimeSec, 8);
  return b;
}

export interface NatPmpResponse {
  opcode: number;
  result: number;
  /** Seconds since the router's mappings were last reset; a drop means it rebooted (3.6). */
  epoch: number;
  /** Public address responses only. */
  publicAddress?: string;
  /** Mapping responses only. */
  internalPort?: number;
  externalPort?: number;
  lifetime?: number;
}

/** Reads a router's answer, or returns null for a packet that isn't a NAT-PMP answer. */
export function parseResponse(b: Buffer): NatPmpResponse | null {
  if (b.length < 8 || b[0] !== 0 || b[1] < 128) return null;
  const res: NatPmpResponse = { opcode: b[1] - 128, result: b.readUInt16BE(2), epoch: b.readUInt32BE(4) };
  if (res.result !== 0) return res;
  if (res.opcode === 0) {
    if (b.length < 12) return null;
    res.publicAddress = [...b.subarray(8, 12)].join('.');
  } else if (res.opcode === 1 || res.opcode === 2) {
    if (b.length < 16) return null;
    res.internalPort = b.readUInt16BE(8);
    res.externalPort = b.readUInt16BE(10);
    res.lifetime = b.readUInt32BE(12);
  } else {
    return null;
  }
  return res;
}

/** Sends `packet` to the router, resending with doubling waits, until an answer to the same request arrives. */
function request(gateway: string, packet: Buffer, opts: NatPmpOptions): Promise<NatPmpResponse> {
  const port = opts.port ?? NAT_PMP_PORT;
  const tries = opts.tries ?? 4;
  let wait = opts.firstWaitMs ?? 250;
  const opcode = packet[1];
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      fn();
    };
    const send = () => {
      if (sent++ === tries) {
        finish(() => reject(new NatPmpError('the router did not answer NAT-PMP', 0)));
        return;
      }
      socket.send(packet, port, gateway, (err) => err && finish(() => reject(err)));
      timer = setTimeout(send, wait);
      wait *= 2;
    };
    socket.on('message', (msg, from) => {
      // RFC 6886 3.1: only the gateway's answers count.
      if (from.address !== gateway || from.port !== port) return;
      const res = parseResponse(msg);
      if (!res || res.opcode !== opcode) return;
      if (res.result !== 0) {
        finish(() => reject(new NatPmpError(RESULTS[res.result] ?? `NAT-PMP error ${res.result}`, res.result)));
      } else {
        finish(() => resolve(res));
      }
    });
    socket.on('error', (err) => finish(() => reject(err)));
    socket.bind(0, send);
  });
}

/** The router's public (WAN) address, as the router sees it. */
export async function natPmpPublicAddress(gateway: string, opts: NatPmpOptions = {}): Promise<string> {
  return (await request(gateway, publicAddressRequest(), opts)).publicAddress!;
}

export interface NatPmpMapping {
  externalPort: number;
  /** Seconds the router keeps it; renew at half of this (RFC 6886 3.3). */
  lifetime: number;
}

/**
 * Asks the router to forward `externalPort` on its public address to `internalPort` on
 * this computer. The router may pick a different external port; the answer says which.
 */
export async function natPmpMap(
  gateway: string,
  protocol: Protocol,
  internalPort: number,
  externalPort: number,
  lifetimeSec: number,
  opts: NatPmpOptions = {},
): Promise<NatPmpMapping> {
  const res = await request(gateway, mapRequest(protocol, internalPort, externalPort, lifetimeSec), opts);
  return { externalPort: res.externalPort!, lifetime: res.lifetime! };
}

export async function natPmpUnmap(gateway: string, protocol: Protocol, internalPort: number, opts: NatPmpOptions = {}): Promise<void> {
  await request(gateway, mapRequest(protocol, internalPort, 0, 0), opts);
}
