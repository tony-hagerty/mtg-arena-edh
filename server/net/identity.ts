/// <reference types="node" />
// The host's TLS identity. All traffic between programs is encrypted with TLS, using a key
// the host's program makes for itself. There's no certificate authority to vouch for it, so
// the join code carries a fingerprint of the key instead, and a friend's program refuses a
// host whose key doesn't match before sending anything.
//
// Node can make keys but not certificates, so certificate() writes the few bytes of a
// self-signed X.509 certificate (RFC 5280) by hand.
import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { connect, type TLSSocket } from 'node:tls';
import { FINGERPRINT_BYTES } from './joincode';

export interface HostIdentity {
  /** PEM text, for tls.createServer({ key, cert }). */
  key: string;
  cert: string;
  /** The first FINGERPRINT_BYTES of the SHA-256 of the public key, as the join code carries it. */
  fingerprint: Uint8Array;
}

/** Makes a new P-256 key and a self-signed certificate for it. */
export function createHostIdentity(name = 'Arena EDH host'): HostIdentity {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const der = certificate(name, spki, privateKey);
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert: `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`,
    fingerprint: fingerprintOfKey(spki),
  };
}

/**
 * The fingerprint of a public key (its SubjectPublicKeyInfo, DER). It covers the key alone,
 * not the whole certificate, so a host can renew its certificate and keep its codes.
 */
export function fingerprintOfKey(spki: Buffer): Uint8Array {
  return new Uint8Array(createHash('sha256').update(spki).digest().subarray(0, FINGERPRINT_BYTES));
}

export function fingerprintOf(cert: X509Certificate): Uint8Array {
  return fingerprintOfKey(cert.publicKey.export({ type: 'spki', format: 'der' }));
}

export function sameFingerprint(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Options for tls.createServer: the host's identity, and TLS 1.3 only, since both ends are this program. */
export function tlsServerOptions(identity: HostIdentity) {
  return { key: identity.key, cert: identity.cert, minVersion: 'TLSv1.3' as const };
}

export class HostIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostIdentityError';
  }
}

/**
 * Connects to a host and resolves once its key matches `fingerprint`. A host with another
 * key is disconnected before anything is sent, with a HostIdentityError.
 */
export function connectToHost(address: string, port: number, fingerprint: Uint8Array, timeoutMs = 10_000): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    // The certificate is self-signed, so the usual check is replaced by the fingerprint check below.
    const socket = connect({ host: address, port, rejectUnauthorized: false, minVersion: 'TLSv1.3', timeout: timeoutMs });
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.once('timeout', () => fail(new Error(`${address}:${port} did not answer`)));
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      const cert = socket.getPeerX509Certificate();
      if (!cert || !sameFingerprint(fingerprintOf(cert), fingerprint)) {
        fail(new HostIdentityError(`${address}:${port} is not the host the code names`));
        return;
      }
      socket.setTimeout(0);
      socket.off('error', fail);
      resolve(socket);
    });
  });
}

// DER, the byte encoding of certificates (X.690): each value is a tag, a length, then its bytes.

function der(tag: number, body: Buffer): Buffer {
  const n = body.length;
  const len = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

const sequence = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));

function integer(bytes: Buffer): Buffer {
  return der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const groups = [n & 127];
    for (let v = n >> 7; v > 0; v >>= 7) groups.unshift((v & 127) | 128);
    out.push(...groups);
  }
  return der(0x06, Buffer.from(out));
}

/** A Name holding only a common name (CN). */
const commonName = (cn: string) => sequence(der(0x31, sequence(oid('2.5.4.3'), der(0x0c, Buffer.from(cn, 'utf8')))));

/** UTCTime, YYMMDDHHMMSSZ, as RFC 5280 4.1.2.5.1 requires for dates before 2050. */
function utcTime(d: Date): Buffer {
  return der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
}

/** "No expiry" (RFC 5280 4.1.2.5): the key is thrown away with the game, not on a date. */
const NEVER = der(0x18, Buffer.from('99991231235959Z'));

const ECDSA_WITH_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));

function certificate(name: string, spki: Buffer, key: KeyObject): Buffer {
  const serial = randomBytes(8);
  serial[0] = (serial[0] & 0x7f) | 0x01; // positive and not zero (RFC 5280 4.1.2.2)
  const tbs = sequence(
    der(0xa0, integer(Buffer.from([2]))), // version 3
    integer(serial),
    ECDSA_WITH_SHA256,
    commonName(name),
    sequence(utcTime(new Date(Date.now() - 86_400_000)), NEVER), // valid from yesterday, for clocks that run slow
    commonName(name),
    spki,
  );
  const signature = sign('sha256', tbs, key); // DER-encoded ECDSA signature
  return sequence(tbs, ECDSA_WITH_SHA256, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
}
