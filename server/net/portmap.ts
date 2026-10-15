/// <reference types="node" />
// Opening the host's port: asks the home router to forward a port on its public address to
// this computer, trying NAT-PMP and UPnP at once and keeping whichever answers first. The
// forward is renewed while the game is hosted and removed by close().
import { defaultGateway, localAddressFor } from './addresses';
import { natPmpMap, natPmpPublicAddress, natPmpUnmap, type NatPmpOptions, type Protocol } from './natpmp';
import { findUpnpGateway, upnpMap, upnpUnmap, UpnpError, UPNP_CONFLICT, UPNP_ONLY_PERMANENT_LEASES, type UpnpOptions } from './upnp';

export interface PortMapOptions extends UpnpOptions {
  protocol?: Protocol;
  /** The port friends connect to on the public address. Defaults to the internal port. */
  externalPort?: number;
  /** Shown in the router's list of forwards. */
  description?: string;
  /** Seconds a forward lasts before it is renewed. */
  leaseSec?: number;
  /** The router's address; looked up from the route table when left out. */
  gateway?: string | null;
  natPmp?: NatPmpOptions;
  /** Called when renewing the forward fails; it is retried at the next renewal. */
  onRenewError?: (err: Error) => void;
}

export interface PortMapping {
  method: 'nat-pmp' | 'upnp';
  internalPort: number;
  /** May differ from the port asked for, when the router picked another or that one was taken. */
  externalPort: number;
  /** The router's public (WAN) address as the router reports it, or null if it didn't say. */
  routerAddress: string | null;
  /** This computer's address on the home network. */
  localAddress: string | null;
  /** Stops renewing and removes the forward. */
  close(): Promise<void>;
}

export interface MapFailure {
  method: 'nat-pmp' | 'upnp';
  message: string;
}

export class PortMapError extends Error {
  constructor(
    readonly failures: MapFailure[],
    /** The router's public address, if a protocol reported it before the forward failed. */
    readonly routerAddress: string | null,
    readonly localAddress: string | null,
  ) {
    super(`The router did not open the port. ${failures.map((f) => `${f.method === 'upnp' ? 'UPnP' : 'NAT-PMP'}: ${f.message}.`).join(' ')}`);
    this.name = 'PortMapError';
  }
}

/** How many ports past the one asked for to try when another computer holds it (UPnP error 718). */
const CONFLICT_TRIES = 10;

/**
 * Forwards a port on the router to `internalPort` on this computer. Throws PortMapError
 * with each protocol's reason when neither works, as when the router has UPnP turned off.
 */
export async function openPort(internalPort: number, opts: PortMapOptions = {}): Promise<PortMapping> {
  const route = opts.gateway === undefined ? await defaultGateway() : opts.gateway ? { gateway: opts.gateway, local: null } : null;
  const gateway = route?.gateway ?? null;
  const shared: Shared = {
    won: false,
    routerAddress: null,
    localAddress: route ? route.local ?? localAddressFor(route.gateway) : null,
  };
  const attempts = [viaNatPmp(gateway, internalPort, opts, shared), viaUpnp(gateway, internalPort, opts, shared)];
  try {
    const winner = await Promise.any(attempts);
    shared.won = true;
    // A slower protocol that also got through is undone, so only one forward is left.
    for (const a of attempts) {
      a.then(
        (m) => {
          if (m !== winner) m.close().catch(() => {});
        },
        () => {},
      );
    }
    return winner;
  } catch (err) {
    shared.won = true;
    const [natPmp, upnp] = (err as AggregateError).errors as Error[];
    throw new PortMapError(
      [
        { method: 'nat-pmp', message: natPmp.message },
        { method: 'upnp', message: upnp.message },
      ],
      shared.routerAddress,
      shared.localAddress,
    );
  }
}

interface Shared {
  /** Set once openPort has its answer, so a slower protocol stops before forwarding. */
  won: boolean;
  routerAddress: string | null;
  localAddress: string | null;
}

/** Calls `renew` every half lease without keeping the program alive just for that. */
function renewEvery(leaseSec: number, renew: () => Promise<unknown>, onError?: (err: Error) => void) {
  if (leaseSec <= 0) return undefined;
  const timer = setInterval(() => renew().catch((err) => onError?.(err)), (leaseSec * 1000) / 2);
  timer.unref();
  return timer;
}

async function viaNatPmp(gateway: string | null, internalPort: number, opts: PortMapOptions, shared: Shared): Promise<PortMapping> {
  if (!gateway) throw new Error('this computer has no default gateway');
  const protocol = opts.protocol ?? 'tcp';
  const address = await natPmpPublicAddress(gateway, opts.natPmp);
  shared.routerAddress ??= address;
  if (shared.won) throw new Error('not needed');
  const ask = (port: number) => natPmpMap(gateway, protocol, internalPort, port, opts.leaseSec ?? 7200, opts.natPmp);
  const mapped = await ask(opts.externalPort ?? internalPort);
  // Renewals ask for the port the router gave (RFC 6886 3.3).
  const timer = renewEvery(mapped.lifetime, () => ask(mapped.externalPort), opts.onRenewError);
  return {
    method: 'nat-pmp',
    internalPort,
    externalPort: mapped.externalPort,
    routerAddress: address,
    localAddress: shared.localAddress,
    async close() {
      clearInterval(timer);
      await natPmpUnmap(gateway, protocol, internalPort, opts.natPmp);
    },
  };
}

async function viaUpnp(gateway: string | null, internalPort: number, opts: PortMapOptions, shared: Shared): Promise<PortMapping> {
  const protocol = opts.protocol ?? 'tcp';
  const timeoutMs = opts.timeoutMs ?? 2500;
  const found = await findUpnpGateway({ ...opts, gateway });
  shared.routerAddress ??= found.publicAddress;
  if (shared.won) throw new Error('not needed');
  const gw = found.gateway;
  let leaseSec = opts.leaseSec ?? 7200;
  let externalPort = opts.externalPort ?? internalPort;
  const add = () => upnpMap(gw, { protocol, externalPort, internalPort, description: opts.description ?? 'Arena EDH', leaseSec }, timeoutMs);
  for (let tries = 0; ; ) {
    try {
      await add();
      break;
    } catch (err) {
      const code = err instanceof UpnpError ? err.code : 0;
      if (code === UPNP_ONLY_PERMANENT_LEASES && leaseSec !== 0) leaseSec = 0;
      else if (code === UPNP_CONFLICT && ++tries < CONFLICT_TRIES) externalPort++;
      else throw err;
    }
  }
  const timer = renewEvery(leaseSec, add, opts.onRenewError);
  return {
    method: 'upnp',
    internalPort,
    externalPort,
    routerAddress: found.publicAddress,
    localAddress: gw.localAddress || shared.localAddress,
    async close() {
      clearInterval(timer);
      await upnpUnmap(gw, protocol, externalPort, timeoutMs);
    },
  };
}
