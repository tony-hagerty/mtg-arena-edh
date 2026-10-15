/// <reference types="node" />
// Can friends reach this computer? Opens the port, reads the router's public address, and
// spots carrier-grade NAT (CGNAT): an internet provider sharing one public address among
// many homes, so nobody outside can connect in and a friend on another network must host.
import { request as httpsRequest } from 'node:https';
import { isIPv4 } from 'node:net';
import { addressKind } from './addresses';
import { openPort, PortMapError, type MapFailure, type PortMapOptions, type PortMapping } from './portmap';

/**
 * Plain-text "what is my IP" services. They are outside servers, so nothing calls them
 * unless the caller passes `allowExternalLookup`: the router reports the public address
 * itself whenever UPnP or NAT-PMP works.
 */
export const PUBLIC_IP_SERVICES = ['https://api.ipify.org', 'https://checkip.amazonaws.com', 'https://icanhazip.com'];

/**
 * What a router's own public (WAN) address says about the network:
 * - `public`: the router is on the internet; a forwarded port reaches this computer.
 * - `cgnat`: the provider's shared range (100.64.0.0/10); nobody outside can connect in.
 * - `double-nat`: a home-network address, so another router (often the provider's modem)
 *   sits in front and would need its own forward.
 */
export type RouterKind = 'public' | 'cgnat' | 'double-nat';

export function classifyRouterAddress(address: string): RouterKind {
  const kind = addressKind(address);
  if (kind === 'public') return 'public';
  return kind === 'shared' ? 'cgnat' : 'double-nat';
}

export type HostCheck =
  /** Friends can connect to publicAddress:port. */
  | { kind: 'open'; publicAddress: string; port: number; localAddress: string | null; mapping: PortMapping }
  /**
   * The router itself is behind CGNAT or another router, so a forward on it doesn't reach
   * the internet. mapping is null when the router also refused to forward.
   */
  | { kind: 'cgnat' | 'double-nat'; routerAddress: string; localAddress: string | null; mapping: PortMapping | null }
  /**
   * The router didn't open the port (UPnP off, or not supported), or opened it without
   * saying its public address. The host can forward the port by hand in the router's
   * settings. publicAddress is null when nothing reported it.
   */
  | {
      kind: 'manual';
      publicAddress: string | null;
      port: number;
      localAddress: string | null;
      failures: MapFailure[];
      mapping: PortMapping | null;
    };

export interface HostCheckOptions extends PortMapOptions {
  /** Ask PUBLIC_IP_SERVICES for the public address when the router can't say. Off by default. */
  allowExternalLookup?: boolean;
}

/**
 * Gets this computer ready to host on `port`: forwards the port and works out the address
 * friends connect to. Any forward it opens stays open; close it with `mapping.close()`.
 */
export async function checkHost(port: number, opts: HostCheckOptions = {}): Promise<HostCheck> {
  let mapping: PortMapping;
  try {
    mapping = await openPort(port, opts);
  } catch (err) {
    if (!(err instanceof PortMapError)) throw err;
    const { routerAddress, localAddress, failures } = err;
    const kind = routerAddress ? classifyRouterAddress(routerAddress) : null;
    if (routerAddress && (kind === 'cgnat' || kind === 'double-nat')) return { kind, routerAddress, localAddress, mapping: null };
    let publicAddress = routerAddress;
    if (!publicAddress && opts.allowExternalLookup) publicAddress = await lookupPublicAddress().catch(() => null);
    return { kind: 'manual', publicAddress, port: opts.externalPort ?? port, localAddress, failures, mapping: null };
  }
  let address = mapping.routerAddress;
  if (!address && opts.allowExternalLookup) address = await lookupPublicAddress().catch(() => null);
  if (!address) {
    // The router forwarded the port but won't say its address: friends can't be told where to go.
    return { kind: 'manual', publicAddress: null, port: mapping.externalPort, localAddress: mapping.localAddress, failures: [], mapping };
  }
  const kind = classifyRouterAddress(address);
  if (kind !== 'public') return { kind, routerAddress: address, localAddress: mapping.localAddress, mapping };
  return { kind: 'open', publicAddress: address, port: mapping.externalPort, localAddress: mapping.localAddress, mapping };
}

/** What to tell the host, in plain words. */
export function explainHostCheck(check: HostCheck): string {
  switch (check.kind) {
    case 'open':
      return 'Your router opened the port. Friends can join with the code.';
    case 'cgnat':
      return (
        'Your internet provider shares one public address among many homes (carrier-grade NAT), ' +
        'so friends outside your home can’t connect to you. Ask a friend on another network to host. ' +
        'Players on your own Wi-Fi can still join.'
      );
    case 'double-nat':
      return (
        `Your router is behind another router or modem (its internet address, ${check.routerAddress}, is a home-network address), ` +
        'so friends outside your home can’t connect yet. Set the modem to bridge mode or forward the port on it too, ' +
        'or ask a friend on another network to host.'
      );
    case 'manual':
      return (
        check.mapping
          ? 'Your router opened the port but didn’t say your public address, so the code can’t be made yet.'
          : `Your router didn’t open the port by itself. In your router’s settings, forward TCP port ${check.port}` +
            `${check.localAddress ? ` to ${check.localAddress}` : ' to this computer'}, or turn on UPnP there.`
      );
  }
}

/** Asks the plain-text services in turn for this network's public address. Only called when allowed. */
export async function lookupPublicAddress(urls: string[] = PUBLIC_IP_SERVICES, timeoutMs = 4000): Promise<string> {
  for (const url of urls) {
    const ip = await getText(url, timeoutMs).then((t) => t.trim(), () => '');
    if (isIPv4(ip)) return ip;
  }
  throw new Error('no public address service answered');
}

function getText(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { timeout: timeoutMs, agent: false }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${url} answered HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body = (body + chunk).slice(0, 100)));
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error(`${url} did not answer`)));
    req.on('error', reject);
    req.end();
  });
}
