/// <reference types="node" />
// UPnP Internet Gateway Device: how most home routers let a program forward a port.
// 1. SSDP: a UDP multicast search on the home network; the router answers with the URL of
//    its device description.
// 2. The description (XML over HTTP) lists the router's services; the WANIPConnection or
//    WANPPPConnection service has a control URL.
// 3. SOAP calls (XML over HTTP POST) to that URL read the public address and add or
//    remove port forwards.
// Everything stays on the home network: the router is the only thing it talks to.
import { createSocket } from 'node:dgram';
import { request as httpRequest } from 'node:http';
import { isIPv4 } from 'node:net';
import type { Protocol } from './natpmp';

export const SSDP_ADDRESS = '239.255.255.250';
export const SSDP_PORT = 1900;

/** What the search asks for: the whole router, or straight for its connection services. */
const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

/** The services that forward ports, best first. */
const WAN_SERVICES = [
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

/** UPnP error codes worth acting on (UPnP IGD WANIPConnection:2, 2.4.16). */
export const UPNP_CONFLICT = 718;
export const UPNP_ONLY_PERMANENT_LEASES = 725;

export class UpnpError extends Error {
  constructor(
    message: string,
    /** The router's UPnP error code, or 0 for a network or format problem. */
    readonly code: number = 0,
  ) {
    super(message);
    this.name = 'UpnpError';
  }
}

export interface UpnpOptions {
  /** How long to wait for routers to answer the search, and for each HTTP call. */
  timeoutMs?: number;
  /** The default gateway, so its answer is tried first when several devices answer. */
  gateway?: string | null;
  /**
   * This computer's address on the router's network. The search goes out that card: left
   * to itself, Windows can send multicast somewhere the router never hears it.
   */
  localAddress?: string | null;
  /** Where the search is sent; only tests change these. */
  ssdpAddress?: string;
  ssdpPort?: number;
}

/** A router's port forwarding service, and this computer's address as the router sees it. */
export interface UpnpGateway {
  controlUrl: string;
  serviceType: string;
  /** The address port forwards should point at: the one this computer used to reach the router. */
  localAddress: string;
}

export function searchMessage(target: string): string {
  return ['M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`, 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${target}`, '', ''].join(
    '\r\n',
  );
}

/** An SSDP answer's headers, with lowercase names, or null if it isn't an HTTP 200 answer. */
export function parseSsdpResponse(text: string): Record<string, string> | null {
  const lines = text.split(/\r?\n/);
  if (!/^HTTP\/1\.[01] 200\b/i.test(lines[0] ?? '')) return null;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

/** Searches the home network for routers, and returns the description URLs they answer with. */
export function ssdpSearch(opts: UpnpOptions = {}): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const found = new Set<string>();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(sortByGateway([...found], opts.gateway));
    };
    // Every router that will answer does so within a moment of the first.
    const timer = setTimeout(finish, timeoutMs);
    socket.on('message', (msg) => {
      const headers = parseSsdpResponse(msg.toString('utf8'));
      const st = headers?.st ?? '';
      if (!headers?.location || !/InternetGatewayDevice|WANIPConnection|WANPPPConnection/.test(st)) return;
      if (found.size === 0) setTimeout(finish, Math.min(300, timeoutMs));
      found.add(headers.location);
    });
    socket.on('error', finish);
    socket.bind(0, () => {
      if (opts.localAddress) {
        try {
          socket.setMulticastInterface(opts.localAddress);
        } catch {
          // Not an address of this computer any more: the system's choice will have to do.
        }
      }
      // UDP can drop a packet, so each search goes out twice.
      for (const target of [...SEARCH_TARGETS, ...SEARCH_TARGETS]) {
        socket.send(searchMessage(target), opts.ssdpPort ?? SSDP_PORT, opts.ssdpAddress ?? SSDP_ADDRESS, () => {});
      }
    });
  });
}

function sortByGateway(locations: string[], gateway: string | null | undefined): string[] {
  const atGateway = (url: string) => {
    try {
      return new URL(url).hostname === gateway;
    } catch {
      return false;
    }
  };
  return [...locations.filter(atGateway), ...locations.filter((l) => !atGateway(l))];
}

interface HttpResult {
  status: number;
  body: string;
  localAddress: string;
}

function http(url: string, timeoutMs: number, post?: { soapAction: string; body: string }): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: post ? 'POST' : 'GET',
        timeout: timeoutMs,
        // A fresh connection each time, closed after: nothing lingers once the call is done.
        agent: false,
        headers: post
          ? {
              'Content-Type': 'text/xml; charset="utf-8"',
              SOAPAction: `"${post.soapAction}"`,
              'Content-Length': Buffer.byteLength(post.body),
            }
          : {},
      },
      (res) => {
        const localAddress = (res.socket?.localAddress ?? '').replace(/^::ffff:/, '');
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_000_000) req.destroy(new UpnpError(`${url} sent too much`));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), localAddress }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new UpnpError(`${url} did not answer`)));
    req.on('error', reject);
    req.end(post?.body);
  });
}

/** The text of the first `<name>` element, with or without a namespace prefix. */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
  return m ? unescapeXml(m[1].trim()) : null;
}

function unescapeXml(s: string): string {
  return s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&${({ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' } as Record<string, string>)[c]};`);
}

/** The port forwarding services a device description lists, best first, with absolute control URLs. */
export function wanServices(description: string, location: string): { serviceType: string; controlUrl: string }[] {
  const base = tag(description, 'URLBase') || location;
  const services = [...description.matchAll(/<(?:[\w-]+:)?service>([\s\S]*?)<\/(?:[\w-]+:)?service>/g)]
    .map((m) => ({ serviceType: tag(m[1], 'serviceType') ?? '', controlUrl: tag(m[1], 'controlURL') ?? '' }))
    .filter((s) => WAN_SERVICES.includes(s.serviceType) && s.controlUrl);
  return services
    .sort((a, b) => WAN_SERVICES.indexOf(a.serviceType) - WAN_SERVICES.indexOf(b.serviceType))
    .map((s) => ({ serviceType: s.serviceType, controlUrl: new URL(s.controlUrl, base).href }));
}

export function soapEnvelope(serviceType: string, action: string, args: [string, string | number][]): string {
  const body = args.map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`).join('');
  return (
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>`
  );
}

/** Calls `action` on the router and returns its answer's XML; a UPnP fault becomes a UpnpError with its code. */
async function soap(gw: UpnpGateway, action: string, args: [string, string | number][], timeoutMs: number): Promise<string> {
  const res = await http(gw.controlUrl, timeoutMs, {
    soapAction: `${gw.serviceType}#${action}`,
    body: soapEnvelope(gw.serviceType, action, args),
  });
  if (res.status === 200) return res.body;
  const code = Number(tag(res.body, 'errorCode') ?? 0);
  const description = tag(res.body, 'errorDescription');
  throw new UpnpError(`the router refused ${action}: ${description ?? `HTTP ${res.status}`}${code ? ` (${code})` : ''}`, code);
}

/** Reads the device description at `location` and returns its port forwarding services. */
export async function upnpServicesAt(location: string, timeoutMs = 2500): Promise<UpnpGateway[]> {
  const res = await http(location, timeoutMs);
  if (res.status !== 200) throw new UpnpError(`${location} answered HTTP ${res.status}`);
  return wanServices(res.body, location).map((s) => ({ ...s, localAddress: res.localAddress }));
}

/**
 * Finds the router's port forwarding service. A router may list a service for each kind of
 * connection it has (cable, DSL), so the first one that can read the public address wins.
 */
export async function findUpnpGateway(opts: UpnpOptions = {}): Promise<{ gateway: UpnpGateway; publicAddress: string | null }> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const locations = await ssdpSearch(opts);
  if (!locations.length) throw new UpnpError('no router answered the UPnP search (UPnP may be turned off in its settings)');
  let last: unknown;
  for (const location of locations) {
    try {
      for (const gateway of await upnpServicesAt(location, timeoutMs)) {
        try {
          return { gateway, publicAddress: await upnpPublicAddress(gateway, timeoutMs) };
        } catch (err) {
          last = err;
        }
      }
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new UpnpError('the router has no UPnP port forwarding service');
}

/** The router's public (WAN) address, or null if it has none yet. */
export async function upnpPublicAddress(gw: UpnpGateway, timeoutMs = 2500): Promise<string | null> {
  const ip = tag(await soap(gw, 'GetExternalIPAddress', [], timeoutMs), 'NewExternalIPAddress');
  return ip && isIPv4(ip) ? ip : null;
}

export interface UpnpMapRequest {
  protocol: Protocol;
  externalPort: number;
  internalPort: number;
  description: string;
  /** Seconds; 0 keeps the forward until it is removed or the router restarts. */
  leaseSec: number;
}

export async function upnpMap(gw: UpnpGateway, m: UpnpMapRequest, timeoutMs = 2500): Promise<void> {
  // Some routers read these by position, so they go in the order the standard lists them.
  await soap(
    gw,
    'AddPortMapping',
    [
      ['NewRemoteHost', ''],
      ['NewExternalPort', m.externalPort],
      ['NewProtocol', m.protocol.toUpperCase()],
      ['NewInternalPort', m.internalPort],
      ['NewInternalClient', gw.localAddress],
      ['NewEnabled', 1],
      ['NewPortMappingDescription', m.description],
      ['NewLeaseDuration', m.leaseSec],
    ],
    timeoutMs,
  );
}

export async function upnpUnmap(gw: UpnpGateway, protocol: Protocol, externalPort: number, timeoutMs = 2500): Promise<void> {
  await soap(
    gw,
    'DeletePortMapping',
    [
      ['NewRemoteHost', ''],
      ['NewExternalPort', externalPort],
      ['NewProtocol', protocol.toUpperCase()],
    ],
    timeoutMs,
  );
}
