/// <reference types="node" />
// Opening the host's port on a pretend router: NAT-PMP, UPnP, choosing between them, and
// what the host is told about their network.
import { afterEach, describe, expect, it } from 'vitest';
import { natPmpMap, natPmpPublicAddress, natPmpUnmap, parseResponse, mapRequest, NatPmpError } from '../../server/net/natpmp';
import { findUpnpGateway, parseSsdpResponse, soapEnvelope, upnpMap, upnpUnmap, wanServices } from '../../server/net/upnp';
import { openPort, PortMapError } from '../../server/net/portmap';
import { checkHost, classifyRouterAddress, explainHostCheck } from '../../server/net/network';
import { fakeRouter, routerOptions, type FakeRouter, type FakeRouterOptions } from './fake-router';

let router: FakeRouter | undefined;
afterEach(async () => {
  await router?.close();
  router = undefined;
});

async function start(opts: FakeRouterOptions = {}) {
  router = await fakeRouter(opts);
  return router;
}

const settle = () => new Promise((r) => setTimeout(r, 600));

describe('NAT-PMP', () => {
  it('writes a mapping request as RFC 6886 3.3 lays it out', () => {
    expect([...mapRequest('tcp', 7420, 7421, 7200)]).toEqual([0, 2, 0, 0, 0x1c, 0xfc, 0x1c, 0xfd, 0, 0, 0x1c, 0x20]);
    expect(mapRequest('udp', 1, 1, 0)[1]).toBe(1);
  });

  it('reads answers and ignores packets that are not answers', () => {
    expect(parseResponse(Buffer.from([0, 128, 0, 0, 0, 0, 0, 9, 203, 0, 113, 7]))).toEqual({ opcode: 0, result: 0, epoch: 9, publicAddress: '203.0.113.7' });
    expect(parseResponse(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // a request, not an answer
    expect(parseResponse(Buffer.from([0, 130, 0, 0]))).toBeNull(); // too short
  });

  it('gets the public address and forwards and removes a port', async () => {
    const r = await start();
    const opts = routerOptions(r).natPmp;
    expect(await natPmpPublicAddress('127.0.0.1', opts)).toBe('203.0.113.7');
    expect(await natPmpMap('127.0.0.1', 'tcp', 7420, 7420, 7200, opts)).toEqual({ externalPort: 7420, lifetime: 7200 });
    expect(r.forwards).toMatchObject([{ method: 'nat-pmp', externalPort: 7420, internalPort: 7420 }]);
    await natPmpUnmap('127.0.0.1', 'tcp', 7420, opts);
    expect(r.forwards).toEqual([]);
  });

  it('says why when the router refuses, and gives up when it never answers', async () => {
    const r = await start({ natPmp: 'refuse' });
    await expect(natPmpPublicAddress('127.0.0.1', routerOptions(r).natPmp)).rejects.toMatchObject({ code: 2, message: /refused/ });
    await r.close();
    router = await start({ natPmp: 'off' });
    const err = await natPmpPublicAddress('127.0.0.1', routerOptions(router).natPmp).catch((e) => e);
    expect(err).toBeInstanceOf(NatPmpError);
    expect(err.code).toBe(0);
  });
});

describe('UPnP', () => {
  it('reads search answers', () => {
    expect(parseSsdpResponse('HTTP/1.1 200 OK\r\nLocation: http://192.168.1.1:5000/rootDesc.xml\r\nST: x\r\n\r\n')).toEqual({
      location: 'http://192.168.1.1:5000/rootDesc.xml',
      st: 'x',
    });
    expect(parseSsdpResponse('NOTIFY * HTTP/1.1\r\n\r\n')).toBeNull();
  });

  it('finds the port forwarding service in a description, best first, with absolute control URLs', () => {
    const xml = `<root><URLBase>http://192.168.1.1:5000/</URLBase>
      <service><serviceType>urn:schemas-upnp-org:service:WANPPPConnection:1</serviceType><controlURL>/ppp</controlURL></service>
      <service><serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/cic</controlURL></service>
      <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>ctl/ip</controlURL></service></root>`;
    expect(wanServices(xml, 'http://192.168.1.1:80/desc.xml')).toEqual([
      { serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1', controlUrl: 'http://192.168.1.1:5000/ctl/ip' },
      { serviceType: 'urn:schemas-upnp-org:service:WANPPPConnection:1', controlUrl: 'http://192.168.1.1:5000/ppp' },
    ]);
  });

  it('escapes what it sends', () => {
    expect(soapEnvelope('urn:x', 'Act', [['NewPortMappingDescription', 'A & <B>']])).toContain('<NewPortMappingDescription>A &amp; &lt;B&gt;</NewPortMappingDescription>');
  });

  it('searches, reads the public address, and forwards and removes a port for this computer', async () => {
    const r = await start();
    const { gateway, publicAddress } = await findUpnpGateway(routerOptions(r));
    expect(publicAddress).toBe('203.0.113.7');
    expect(gateway.controlUrl).toBe(`http://127.0.0.1:${r.httpPort}/ctl/IPConn`);
    expect(gateway.localAddress).toBe('127.0.0.1');
    await upnpMap(gateway, { protocol: 'tcp', externalPort: 7420, internalPort: 7420, description: 'Arena EDH', leaseSec: 3600 });
    expect(r.forwards).toEqual([{ method: 'upnp', protocol: 'tcp', externalPort: 7420, internalPort: 7420, client: '127.0.0.1', lease: 3600 }]);
    await upnpUnmap(gateway, 'tcp', 7420);
    expect(r.forwards).toEqual([]);
    await expect(upnpUnmap(gateway, 'tcp', 7420)).rejects.toMatchObject({ code: 714 });
  });

  it('says so when nothing answers the search', async () => {
    const r = await start({ upnp: 'off' });
    await expect(findUpnpGateway(routerOptions(r))).rejects.toThrow(/UPnP may be turned off/);
  });
});

describe('opening the port', () => {
  it('uses NAT-PMP when the router speaks it, leaving one forward', async () => {
    const r = await start();
    const m = await openPort(7420, routerOptions(r));
    expect(m).toMatchObject({ method: 'nat-pmp', internalPort: 7420, externalPort: 7420, routerAddress: '203.0.113.7' });
    await settle();
    expect(r.forwards).toHaveLength(1);
    await m.close();
    expect(r.forwards).toEqual([]);
  });

  it('uses UPnP when NAT-PMP is off', async () => {
    const r = await start({ natPmp: 'off' });
    const m = await openPort(7420, routerOptions(r));
    expect(m).toMatchObject({ method: 'upnp', externalPort: 7420, routerAddress: '203.0.113.7', localAddress: '127.0.0.1' });
    await m.close();
    expect(r.forwards).toEqual([]);
  });

  it('falls back to a permanent forward on routers that only allow those', async () => {
    const r = await start({ natPmp: 'off', onlyPermanentLeases: true });
    const m = await openPort(7420, routerOptions(r));
    expect(r.forwards).toMatchObject([{ externalPort: 7420, lease: 0 }]);
    await m.close();
  });

  it('moves to the next port when another computer holds the one asked for', async () => {
    const r = await start({ natPmp: 'off', takenPorts: [7420, 7421] });
    const m = await openPort(7420, routerOptions(r));
    expect(m.externalPort).toBe(7422);
    expect(r.forwards).toMatchObject([{ externalPort: 7422, internalPort: 7420 }]);
    await m.close();
  });

  it("gives each protocol's reason when the router opens nothing", async () => {
    const r = await start({ natPmp: 'refuse', upnp: 'off' });
    const err = await openPort(7420, routerOptions(r)).catch((e) => e);
    expect(err).toBeInstanceOf(PortMapError);
    expect(err.failures.map((f: { method: string }) => f.method)).toEqual(['nat-pmp', 'upnp']);
    expect(err.message).toMatch(/NAT-PMP: the router refused.*UPnP: no router answered/);
    expect(err.routerAddress).toBeNull();
  });
});

describe("the host's network", () => {
  it('sorts router addresses into public, CGNAT and double NAT', () => {
    expect(classifyRouterAddress('203.0.113.7')).toBe('public');
    expect(classifyRouterAddress('100.64.0.1')).toBe('cgnat');
    expect(classifyRouterAddress('100.127.255.254')).toBe('cgnat');
    expect(classifyRouterAddress('100.128.0.1')).toBe('public');
    expect(classifyRouterAddress('192.168.0.2')).toBe('double-nat');
    expect(classifyRouterAddress('10.1.2.3')).toBe('double-nat');
  });

  it('is open when the router forwards the port and has a public address', async () => {
    const r = await start();
    const check = await checkHost(7420, routerOptions(r));
    expect(check).toMatchObject({ kind: 'open', publicAddress: '203.0.113.7', port: 7420 });
    expect(explainHostCheck(check)).toMatch(/Friends can join/);
    if (check.kind === 'open') await check.mapping.close();
  });

  it('spots carrier-grade NAT from the address the router reports', async () => {
    const r = await start({ publicAddress: '100.72.14.3' });
    const check = await checkHost(7420, routerOptions(r));
    expect(check).toMatchObject({ kind: 'cgnat', routerAddress: '100.72.14.3' });
    expect(explainHostCheck(check)).toMatch(/friend on another network to host/);
    if (check.kind === 'cgnat') await check.mapping?.close();
  });

  it('spots carrier-grade NAT even when the router refuses to forward', async () => {
    const r = await start({ publicAddress: '100.72.14.3', natPmp: 'refuse-map', upnp: 'off' });
    expect(await checkHost(7420, routerOptions(r))).toEqual({ kind: 'cgnat', routerAddress: '100.72.14.3', localAddress: null, mapping: null });
  });

  it('asks the host to forward the port by hand when the router opens nothing, without asking an outside server', async () => {
    const r = await start({ natPmp: 'off', upnp: 'off' });
    const check = await checkHost(7420, routerOptions(r));
    expect(check).toMatchObject({ kind: 'manual', publicAddress: null, port: 7420 });
    expect(explainHostCheck({ ...check, localAddress: '192.168.1.23' } as typeof check)).toMatch(/forward TCP port 7420 to 192\.168\.1\.23/);
  });
});
