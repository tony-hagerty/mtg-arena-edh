/// <reference types="node" />
// Addresses, the connection code, and the host's TLS identity.
import { createServer, type TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addressKind, localAddressFor, parseLinuxRoutes, parseWindowsRoutes } from '../../server/net/addresses';
import { decodeJoinCode, encodeJoinCode, JoinCodeError, newJoinPassword, passwordsMatch, type JoinInfo } from '../../server/net/joincode';
import { connectToHost, createHostIdentity, fingerprintOf, HostIdentityError, tlsServerOptions } from '../../server/net/identity';

describe('addresses', () => {
  it('tells public, home, shared and unusable addresses apart', () => {
    const kinds = Object.fromEntries(
      ['8.8.8.8', '10.0.0.5', '172.16.0.1', '172.32.0.1', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.3.4', '0.1.2.3', '224.0.0.1', '255.255.255.255', 'nope', '::1'].map((ip) => [
        ip,
        addressKind(ip),
      ]),
    );
    expect(kinds).toEqual({
      '8.8.8.8': 'public',
      '10.0.0.5': 'private',
      '172.16.0.1': 'private',
      '172.32.0.1': 'public',
      '192.168.1.1': 'private',
      '100.64.0.1': 'shared',
      '127.0.0.1': 'loopback',
      '169.254.3.4': 'link-local',
      '0.1.2.3': 'invalid',
      '224.0.0.1': 'invalid',
      '255.255.255.255': 'invalid',
      nope: 'invalid',
      '::1': 'invalid',
    });
  });

  it("reads the default gateway from Windows' route table, lowest metric first", () => {
    const out = `===========================================================================
IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      10.0.0.1       10.0.0.44     50
          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.23     25
===========================================================================
Persistent Routes:
  None
`;
    expect(parseWindowsRoutes(out)).toEqual({ gateway: '192.168.1.1', local: '192.168.1.23' });
    expect(parseWindowsRoutes('Active Routes:\nNone\n')).toBeNull();
  });

  it("reads the default gateway from Linux's route table", () => {
    const out = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
`;
    expect(parseLinuxRoutes(out)).toEqual({ gateway: '192.168.1.1', local: null });
  });

  it("finds this computer's address on the router's network", () => {
    const ifaces = {
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' }],
      vEthernet: [{ address: '172.20.0.1', netmask: '255.255.240.0', family: 'IPv4', mac: '', internal: false, cidr: '172.20.0.1/20' }],
      'Wi-Fi': [{ address: '192.168.1.23', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.23/24' }],
    } as unknown as Parameters<typeof localAddressFor>[1];
    expect(localAddressFor('192.168.1.1', ifaces)).toBe('192.168.1.23');
    expect(localAddressFor('10.0.0.1', ifaces)).toBeNull();
  });
});

describe('the connection code', () => {
  const info = (): JoinInfo => ({
    address: '203.0.113.7',
    port: 7420,
    password: Uint8Array.from([1, 2, 3, 4, 5, 6]),
    fingerprint: Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]),
  });

  it('packs the address, port, password and fingerprint into 40 characters and reads them back', () => {
    const code = encodeJoinCode(info());
    expect(code).toMatch(/^ARENA(-[0-9A-HJKMNP-TV-Z]{4}){10}$/);
    expect(decodeJoinCode(code)).toEqual(info());
  });

  it('reads a code however it was pasted', () => {
    const code = encodeJoinCode(info());
    const messy = `  ${code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')}\n`;
    expect(decodeJoinCode(messy)).toEqual(info());
    expect(decodeJoinCode(code.replace('ARENA-', ''))).toEqual(info());
  });

  it('catches typos and says what is wrong', () => {
    const code = encodeJoinCode(info());
    const swapped = code.slice(0, -1) + (code.endsWith('Z') ? 'Y' : 'Z');
    expect(() => decodeJoinCode(swapped)).toThrow(/typo/);
    expect(() => decodeJoinCode(code.slice(0, -2))).toThrow(/too short/);
    expect(() => decodeJoinCode(code + 'U')).toThrow(JoinCodeError);
    // Changing any one character is caught.
    const chars = code.replace(/^ARENA-/, '');
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === '-') continue;
      const changed = chars.slice(0, i) + (chars[i] === '2' ? '3' : '2') + chars.slice(i + 1);
      expect(() => decodeJoinCode(changed), `character ${i}`).toThrow(JoinCodeError);
    }
  });

  it('refuses what it cannot carry', () => {
    expect(() => encodeJoinCode({ ...info(), address: '::1' })).toThrow(/IPv4/);
    expect(() => encodeJoinCode({ ...info(), port: 0 })).toThrow(/port/);
    expect(() => encodeJoinCode({ ...info(), password: new Uint8Array(3) })).toThrow(/password/);
  });

  it('makes random passwords and compares them', () => {
    const a = newJoinPassword();
    expect(a).toHaveLength(6);
    expect(passwordsMatch(a, Uint8Array.from(a))).toBe(true);
    expect(passwordsMatch(a, newJoinPassword())).toBe(false);
    expect(passwordsMatch(a, a.subarray(1))).toBe(false);
  });
});

describe("the host's TLS identity", () => {
  it('makes a valid self-signed certificate whose key matches the fingerprint', () => {
    const id = createHostIdentity();
    const cert = new X509Certificate(id.cert);
    expect(cert.subject).toBe('CN=Arena EDH host');
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkPrivateKey(createPrivateKey(id.key))).toBe(true);
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(Date.now());
    expect(new Date(cert.validTo).getFullYear()).toBe(9999);
    expect(fingerprintOf(cert)).toEqual(id.fingerprint);
    expect(id.fingerprint).toHaveLength(10);
    expect(createHostIdentity().fingerprint).not.toEqual(id.fingerprint);
  });

  async function host(): Promise<{ port: number; fingerprint: Uint8Array; close(): void }> {
    const id = createHostIdentity();
    const server = createServer(tlsServerOptions(id), (socket: TLSSocket) => socket.end('hello'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { port: (server.address() as AddressInfo).port, fingerprint: id.fingerprint, close: () => server.close() };
  }

  it('connects over TLS 1.3 to the host the code names', async () => {
    const h = await host();
    try {
      const socket = await connectToHost('127.0.0.1', h.port, h.fingerprint);
      expect(socket.getProtocol()).toBe('TLSv1.3');
      const text = await new Promise<string>((r) => {
        let s = '';
        socket.on('data', (d) => (s += d));
        socket.on('end', () => r(s));
      });
      expect(text).toBe('hello');
    } finally {
      h.close();
    }
  });

  it('refuses a host with another key', async () => {
    const h = await host();
    try {
      const other = createHostIdentity().fingerprint;
      await expect(connectToHost('127.0.0.1', h.port, other)).rejects.toBeInstanceOf(HostIdentityError);
    } finally {
      h.close();
    }
  });
});
