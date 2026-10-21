// The line protocol between a host's program and a friend's (server/lobby/wire.ts).
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { receive, send } from '../server/lobby/wire';

/** A connected pair of sockets on this computer: the "host's" end and the "friend's". */
async function pair(): Promise<{ host: Socket; friend: Socket; close: () => void }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const hostSide = new Promise<Socket>((resolve) => server.once('connection', resolve));
  const { connect } = await import('node:net');
  const friend = connect((server.address() as AddressInfo).port, '127.0.0.1');
  await new Promise<void>((resolve) => friend.once('connect', resolve));
  const host = await hostSide;
  return { host, friend, close: () => (friend.destroy(), host.destroy(), server.close()) };
}

const closed = (s: Socket) => new Promise<void>((resolve) => (s.destroyed ? resolve() : s.once('close', () => resolve())));

describe('receive', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  it('hands over each message in order, one JSON object per line', async () => {
    const { host, friend, close } = await pair();
    cleanup = close;
    const got: unknown[] = [];
    receive(host, (m) => got.push(m));
    send(friend, { t: 'ready', ready: true });
    friend.write('{"t":"leave"}\n{"t":"speed",');
    friend.write('"speed":2}\n');
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toEqual([{ t: 'ready', ready: true }, { t: 'leave' }, { t: 'speed', speed: 2 }]);
  });

  it('ends the connection on a line that is not a JSON object, without calling the handler', async () => {
    for (const line of ['null', '7', '"hello"', 'not json']) {
      const { host, friend, close } = await pair();
      const got: unknown[] = [];
      // The handlers read the message's fields: a `null` here would throw in the socket's event and take the program down.
      receive(host, (m: { t: string }) => got.push(m.t));
      friend.write(`${line}\n`);
      await closed(host);
      expect(got).toEqual([]);
      close();
    }
  });
});
