/// <reference types="node" />
// The connection code the host pastes to friends, such as
// ARENA-235G-0W87-3KYB-WPWP-7QMM-X1X8-W3V5-D4JD-E66S-JKCE. With no outside server to look
// a short code up, the code itself carries everything a friend's program needs:
//   byte 0       format version (high 4 bits) and address type (low 4 bits, 0 = IPv4)
//   bytes 1-4    the host's IPv4 address (public, or local for players on the same Wi-Fi)
//   bytes 5-6    the port
//   bytes 7-12   the join password (48 random bits), which keeps strangers out
//   bytes 13-22  the first 80 bits of the SHA-256 of the host's TLS public key (identity.ts),
//                so nobody else can pose as the host
//   bytes 23-24  a checksum, so a mistyped code says so instead of failing to connect
// 25 bytes are 40 base-32 characters, written in groups of 4 after "ARENA".
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIPv4 } from 'node:net';

export const PASSWORD_BYTES = 6;
export const FINGERPRINT_BYTES = 10;
const VERSION = 1;
const IPV4 = 0;
const LENGTH = 25;
const PREFIX = 'ARENA';

/** Crockford's base 32: no I, L, O or U, so nothing in a code looks like something else. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface JoinInfo {
  address: string;
  port: number;
  password: Uint8Array;
  fingerprint: Uint8Array;
}

export class JoinCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JoinCodeError';
  }
}

export function newJoinPassword(): Uint8Array {
  return new Uint8Array(randomBytes(PASSWORD_BYTES));
}

/** Compares a password a friend sent with the host's, taking the same time whatever they share. */
export function passwordsMatch(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function checksum(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest().subarray(0, 2);
}

export function encodeJoinCode(info: JoinInfo): string {
  if (!isIPv4(info.address)) throw new JoinCodeError(`${info.address} is not an IPv4 address`);
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) throw new JoinCodeError(`${info.port} is not a port`);
  if (info.password.length !== PASSWORD_BYTES) throw new JoinCodeError(`the join password must be ${PASSWORD_BYTES} bytes`);
  if (info.fingerprint.length < FINGERPRINT_BYTES) throw new JoinCodeError(`the fingerprint must be at least ${FINGERPRINT_BYTES} bytes`);
  const b = Buffer.alloc(LENGTH);
  b[0] = (VERSION << 4) | IPV4;
  info.address.split('.').forEach((part, i) => (b[1 + i] = Number(part)));
  b.writeUInt16BE(info.port, 5);
  b.set(info.password, 7);
  b.set(info.fingerprint.subarray(0, FINGERPRINT_BYTES), 13);
  checksum(b.subarray(0, 23)).copy(b, 23);
  const chars = toBase32(b);
  return [PREFIX, ...chars.match(/.{4}/g)!].join('-');
}

/**
 * Reads a pasted code. Case, spaces, dashes and the "ARENA" prefix don't matter, and O, I
 * and L are read as 0, 1 and 1. Throws JoinCodeError with a plain reason for a bad code.
 */
export function decodeJoinCode(code: string): JoinInfo {
  let chars = code.toUpperCase().replace(/[\s-]/g, '');
  if (chars.startsWith(PREFIX)) chars = chars.slice(PREFIX.length);
  chars = chars.replace(/O/g, '0').replace(/[IL]/g, '1');
  const bad = chars.match(new RegExp(`[^${ALPHABET}]`));
  if (bad) throw new JoinCodeError(`The code has a "${bad[0]}" in it, which no code has. Copy it again.`);
  if (chars.length !== (LENGTH * 8) / 5) throw new JoinCodeError('The code is too short or too long. Copy the whole code again.');
  const b = fromBase32(chars);
  if (!checksum(b.subarray(0, 23)).equals(b.subarray(23, 25))) throw new JoinCodeError('The code has a typo in it. Copy it again.');
  if (b[0] >> 4 !== VERSION || (b[0] & 15) !== IPV4) throw new JoinCodeError('The code is from a different version of the game.');
  return {
    address: [...b.subarray(1, 5)].join('.'),
    port: b.readUInt16BE(5),
    password: new Uint8Array(b.subarray(7, 13)),
    fingerprint: new Uint8Array(b.subarray(13, 23)),
  };
}

function toBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return bits ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

function fromBase32(chars: string): Buffer {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of chars) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}
