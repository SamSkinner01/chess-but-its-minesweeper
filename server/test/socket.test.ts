import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClientToServerEvents, GameView, ServerToClientEvents } from '../../shared/protocol';
import { GameService, type IO } from '../src/GameService';
import { MemoryGameStore } from '../src/store/GameStore';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = '';
let ioServer: IO;
const store = new MemoryGameStore();
const clients: Client[] = [];

beforeAll(async () => {
  const http = createServer();
  ioServer = new Server(http);
  new GameService(ioServer, store);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  url = `http://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(() => {
  clients.forEach((c) => c.disconnect());
  ioServer.close();
});

async function client() {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise<void>((resolve) => c.on('connect', resolve));
  // Record every raw payload so we can assert nothing secret ever arrives.
  const raw: string[] = [];
  c.onAny((_event, ...args) => raw.push(JSON.stringify(args)));
  return { c, raw };
}

function nextState(c: Client, predicate: (v: GameView) => boolean = () => true) {
  return new Promise<GameView>((resolve) => {
    const handler = (v: GameView) => {
      if (!predicate(v)) return;
      c.off('state', handler);
      resolve(v);
    };
    c.on('state', handler);
  });
}

const emit = <T>(c: Client, event: 'create' | 'join' | 'move', payload: unknown) =>
  new Promise<T>((resolve) => (c.emit as (...a: unknown[]) => void)(event, payload, resolve));

describe('multiplayer flow over Socket.IO', () => {
  it('creates, joins, plays, reconnects and keeps mines secret', async () => {
    const alice = await client();
    const created = await emit<{ ok: true; code: string; token: string }>(alice.c, 'create', {
      name: 'Alice',
      color: 'w',
      settings: { mines: 12, timeControl: 5, mineZone: 'middle' },
    });
    expect(created.ok).toBe(true);
    const { code, token } = created;

    const aliceWaiting = nextState(alice.c);
    const aliceJoin = await emit<{ ok: true; role: string }>(alice.c, 'join', { code, token, name: 'Alice' });
    expect(aliceJoin.role).toBe('w');
    expect((await aliceWaiting).status).toBe('waiting');

    const bob = await client();
    const aliceActive = nextState(alice.c, (v) => v.status === 'active');
    const bobJoin = await emit<{ ok: true; role: string; token: string }>(bob.c, 'join', { code, name: 'Bob' });
    expect(bobJoin.role).toBe('b');
    const view = await aliceActive;
    expect(view.players.b?.name).toBe('Bob');
    expect(Object.keys(view.legalMoves)).toHaveLength(10);

    // Bob can't move for White.
    const wrong = await emit<{ ok: boolean }>(bob.c, 'move', { from: 'e7', to: 'e5' });
    expect(wrong.ok).toBe(false);

    const afterMove = nextState(bob.c, (v) => v.moves.length === 1);
    expect((await emit<{ ok: boolean }>(alice.c, 'move', { from: 'e2', to: 'e4' })).ok).toBe(true);
    const bobView = await afterMove;
    expect(bobView.turn).toBe('b');
    expect(bobView.clock?.running).toBe('b');
    // The landing square is either revealed with a number or blew up.
    expect('e4' in bobView.revealed || bobView.detonated.includes('e4')).toBe(true);

    // A third visitor becomes a spectator.
    const carol = await client();
    const carolJoin = await emit<{ ok: true; role: string; token: null }>(carol.c, 'join', { code, name: 'Carol' });
    expect(carolJoin.role).toBe('spectator');
    expect(carolJoin.token).toBeNull();

    // Bob "refreshes": a brand-new socket with his token gets his seat back.
    bob.c.disconnect();
    const bob2 = await client();
    const rejoin = await emit<{ ok: true; role: string }>(bob2.c, 'join', { code, token: bobJoin.token, name: '' });
    expect(rejoin.role).toBe('b');

    // Nothing any client received may contain the mine list or someone else's token.
    const secret = (await store.get(code))!;
    for (const payload of [...alice.raw, ...bob.raw, ...carol.raw, ...bob2.raw]) {
      expect(payload).not.toContain('"mines":[');
      expect(payload).not.toContain(token);
    }
    expect(secret.mines).toHaveLength(12);
  });

  it('rejects unknown rooms and bad settings', async () => {
    const { c } = await client();
    expect(await emit<{ ok: boolean }>(c, 'join', { code: 'NOPE99', name: 'x' })).toMatchObject({ ok: false });
    expect(
      await emit<{ ok: boolean }>(c, 'create', { name: 'x', color: 'w', settings: { mines: 99, timeControl: 5, mineZone: 'middle' } }),
    ).toMatchObject({ ok: false });
  });
});
