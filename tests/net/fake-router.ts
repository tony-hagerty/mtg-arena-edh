/// <reference types="node" />
// A pretend home router on 127.0.0.1 for the connection tests: it answers NAT-PMP, the
// UPnP search, the device description and the SOAP calls, and records the forwards it holds.
import { createSocket, type Socket } from 'node:dgram';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeRouterOptions {
  publicAddress?: string;
  /** refuse-map answers the public address but refuses every forward. */
  natPmp?: 'on' | 'off' | 'refuse' | 'refuse-map';
  upnp?: 'on' | 'off';
  /** UPnP routers that refuse leases other than 0 (error 725). */
  onlyPermanentLeases?: boolean;
  /** External ports another computer already holds (UPnP error 718). */
  takenPorts?: number[];
}

export interface Forward {
  method: 'nat-pmp' | 'upnp';
  protocol: string;
  externalPort: number;
  internalPort: number;
  client?: string;
  lease: number;
}

export interface FakeRouter {
  natPmpPort: number;
  ssdpPort: number;
  httpPort: number;
  forwards: Forward[];
  /** How many times each SOAP action was called. */
  calls: Record<string, number>;
  close(): Promise<void>;
}

const DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType>
        <controlURL>/ctl/L3F</controlURL>
      </service>
    </serviceList>
    <deviceList><device>
      <deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>
      <deviceList><device>
        <deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType>
        <serviceList>
          <service>
            <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
            <serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId>
            <controlURL>ctl/IPConn</controlURL>
          </service>
        </serviceList>
      </device></deviceList>
    </device></deviceList>
  </device>
</root>`;

function fault(code: number, description: string): string {
  return (
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>' +
    '<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>' +
    `<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${description}</errorDescription></UPnPError>` +
    '</detail></s:Fault></s:Body></s:Envelope>'
  );
}

const arg = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '';

export async function fakeRouter(opts: FakeRouterOptions = {}): Promise<FakeRouter> {
  const publicAddress = opts.publicAddress ?? '203.0.113.7';
  const forwards: Forward[] = [];
  const calls: Record<string, number> = {};

  const natPmp = createSocket('udp4');
  natPmp.on('message', (msg, from) => {
    if (opts.natPmp === 'off') return;
    const op = msg[1];
    const res = Buffer.alloc(op === 0 ? 12 : 16);
    res[1] = 128 + op;
    res.writeUInt32BE(1234, 4);
    if (opts.natPmp === 'refuse' || (opts.natPmp === 'refuse-map' && op !== 0)) res.writeUInt16BE(2, 2);
    else if (op === 0) publicAddress.split('.').forEach((p, i) => (res[8 + i] = Number(p)));
    else {
      const internalPort = msg.readUInt16BE(4);
      const lifetime = msg.readUInt32BE(8);
      const protocol = op === 1 ? 'udp' : 'tcp';
      const i = forwards.findIndex((f) => f.method === 'nat-pmp' && f.internalPort === internalPort && f.protocol === protocol);
      if (i >= 0) forwards.splice(i, 1);
      const externalPort = lifetime === 0 ? 0 : msg.readUInt16BE(6) || internalPort;
      if (lifetime > 0) forwards.push({ method: 'nat-pmp', protocol, externalPort, internalPort, lease: lifetime });
      res.writeUInt16BE(internalPort, 8);
      res.writeUInt16BE(externalPort, 10);
      res.writeUInt32BE(lifetime, 12);
    }
    natPmp.send(res, from.port, from.address);
  });

  const http: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/desc.xml') {
        res.writeHead(200, { 'Content-Type': 'text/xml' }).end(DESCRIPTION);
        return;
      }
      const action = String(req.headers.soapaction ?? '').replace(/"/g, '').split('#')[1];
      calls[action] = (calls[action] ?? 0) + 1;
      const reply = (xml: string) => res.writeHead(200, { 'Content-Type': 'text/xml' }).end(xml);
      const refuse = (code: number, text: string) => res.writeHead(500, { 'Content-Type': 'text/xml' }).end(fault(code, text));
      const externalPort = Number(arg(body, 'NewExternalPort'));
      const protocol = arg(body, 'NewProtocol').toLowerCase();
      if (req.url !== '/ctl/IPConn') refuse(401, 'Invalid Action');
      else if (action === 'GetExternalIPAddress') reply(`<u:R><NewExternalIPAddress>${publicAddress}</NewExternalIPAddress></u:R>`);
      else if (action === 'AddPortMapping') {
        const lease = Number(arg(body, 'NewLeaseDuration'));
        if (opts.onlyPermanentLeases && lease !== 0) return refuse(725, 'OnlyPermanentLeasesSupported');
        if (opts.takenPorts?.includes(externalPort)) return refuse(718, 'ConflictInMappingEntry');
        const i = forwards.findIndex((f) => f.method === 'upnp' && f.externalPort === externalPort && f.protocol === protocol);
        if (i >= 0) forwards.splice(i, 1);
        forwards.push({ method: 'upnp', protocol, externalPort, internalPort: Number(arg(body, 'NewInternalPort')), client: arg(body, 'NewInternalClient'), lease });
        reply('<u:AddPortMappingResponse/>');
      } else if (action === 'DeletePortMapping') {
        const i = forwards.findIndex((f) => f.method === 'upnp' && f.externalPort === externalPort && f.protocol === protocol);
        if (i < 0) return refuse(714, 'NoSuchEntryInArray');
        forwards.splice(i, 1);
        reply('<u:DeletePortMappingResponse/>');
      } else refuse(401, 'Invalid Action');
    });
  });

  const ssdp = createSocket('udp4');
  ssdp.on('message', (msg, from) => {
    if (opts.upnp === 'off') return;
    const st = msg.toString().match(/^ST: (.*)$/m)?.[1].trim() ?? '';
    const port = (http.address() as AddressInfo).port;
    ssdp.send(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nST: ${st}\r\nLOCATION: http://127.0.0.1:${port}/desc.xml\r\n\r\n`, from.port, from.address);
  });

  await Promise.all([
    new Promise<void>((r) => natPmp.bind(0, '127.0.0.1', r)),
    new Promise<void>((r) => ssdp.bind(0, '127.0.0.1', r)),
    new Promise<void>((r) => http.listen(0, '127.0.0.1', r)),
  ]);
  const udpPort = (s: Socket) => s.address().port;
  return {
    natPmpPort: udpPort(natPmp),
    ssdpPort: udpPort(ssdp),
    httpPort: (http.address() as AddressInfo).port,
    forwards,
    calls,
    async close() {
      natPmp.close();
      ssdp.close();
      await new Promise((r) => http.close(r));
    },
  };
}

/** openPort options that point at the fake router, with short waits. */
export function routerOptions(router: FakeRouter) {
  return {
    gateway: '127.0.0.1',
    natPmp: { port: router.natPmpPort, tries: 2, firstWaitMs: 50 },
    ssdpAddress: '127.0.0.1',
    ssdpPort: router.ssdpPort,
    timeoutMs: 400,
  };
}
