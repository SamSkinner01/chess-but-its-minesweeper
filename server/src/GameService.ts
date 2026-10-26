import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  MAX_CHAT_LENGTH,
  MAX_MINES,
  MAX_NAME_LENGTH,
  MIN_MINES,
  TIME_CONTROLS,
  type ChatMessage,
  type ClientToServerEvents,
  type Color,
  type CreateGamePayload,
  type GameSettings,
  type Role,
  type ServerToClientEvents,
} from '../../shared/protocol';
import {
  applyMove,
  checkTimeout,
  createGame,
  resign,
  startRematch,
  toggleFlag,
  turnOf,
} from './game/engine';
import type { GameState } from './game/types';
import { buildView, type Presence } from './game/view';
import type { GameStore } from './store/GameStore';

interface SocketData {
  code?: string;
  role?: Role;
  name?: string;
  lastChatAt?: number;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Reply = (res: { ok: true; [key: string]: unknown } | { ok: false; error: string }) => void;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CHAT_HISTORY = 100;
const CHAT_COOLDOWN_MS = 400;

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) : '';
  return name || fallback;
}

function parseSettings(value: unknown): GameSettings | null {
  const s = value as Partial<GameSettings> | undefined;
  if (!s || typeof s !== 'object') return null;
  const mines = Number(s.mines);
  if (!Number.isInteger(mines) || mines < MIN_MINES || mines > MAX_MINES) return null;
  if (!TIME_CONTROLS.includes(s.timeControl as never)) return null;
  if (s.mineZone !== 'middle' && s.mineZone !== 'anywhere') return null;
  return { mines, timeControl: s.timeControl!, mineZone: s.mineZone };
}

const newToken = () => randomBytes(16).toString('hex');
// Not "White"/"Black": colors swap on rematch, so a color as a name would mislead.
const guestName = () => `Guest ${randomInt(1000, 10000)}`;

export class GameService {
  /** Live sockets per game code. Runtime only; rebuilt naturally as clients reconnect. */
  private rooms = new Map<string, Set<ClientSocket>>();
  private clockTimers = new Map<string, NodeJS.Timeout>();
  private locks = new Map<string, Promise<unknown>>();
  private chatSeq = 0;

  constructor(
    private io: IO,
    private store: GameStore,
  ) {
    io.on('connection', (socket) => this.onConnection(socket));
  }

  /**
   * Runs `fn` against a game with exclusive access, then persists it. Operations on
   * one game are queued, so an async store can't interleave two moves.
   */
  private withGame<T>(code: string, fn: (state: GameState) => T): Promise<T | undefined> {
    const prev = this.locks.get(code) ?? Promise.resolve();
    const run = prev.then(async () => {
      const state = await this.store.get(code);
      if (!state) return undefined;
      const out = fn(state);
      await this.store.save(state);
      return out;
    });
    const settled = run.catch(() => undefined);
    this.locks.set(code, settled);
    void settled.then(() => {
      if (this.locks.get(code) === settled) this.locks.delete(code);
    });
    return run;
  }

  private presence(code: string): Presence {
    const connected: Record<Color, boolean> = { w: false, b: false };
    let spectators = 0;
    for (const s of this.rooms.get(code) ?? []) {
      if (s.data.role === 'spectator') spectators++;
      else if (s.data.role) connected[s.data.role] = true;
    }
    return { connected, spectators };
  }

  /** Sends each socket its own redacted view of the game. */
  private broadcast(state: GameState, onlyRole?: Role) {
    const presence = this.presence(state.code);
    const now = Date.now();
    for (const s of this.rooms.get(state.code) ?? []) {
      if (onlyRole && s.data.role !== onlyRole) continue;
      s.emit('state', buildView(state, s.data.role ?? 'spectator', presence, now));
    }
  }

  /** Arms a server-side timer that flags whoever is on move when their time runs out. */
  private scheduleClock(state: GameState) {
    clearTimeout(this.clockTimers.get(state.code));
    this.clockTimers.delete(state.code);
    const clock = state.clock;
    if (state.status !== 'active' || !clock || clock.turnStartedAt === null) return;
    const remaining = clock[turnOf(state)] - (Date.now() - clock.turnStartedAt);
    const timer = setTimeout(() => {
      void this.withGame(state.code, (s) => {
        if (checkTimeout(s, Date.now())) this.broadcast(s);
        else this.scheduleClock(s);
      });
    }, Math.max(0, remaining) + 25);
    this.clockTimers.set(state.code, timer);
  }

  private async newCode(): Promise<string> {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!(await this.store.has(code))) return code;
    }
  }

  private leaveCurrent(socket: ClientSocket) {
    const code = socket.data.code;
    if (!code) return;
    void socket.leave(code);
    const room = this.rooms.get(code);
    room?.delete(socket);
    if (room?.size === 0) this.rooms.delete(code);
    socket.data.code = undefined;
    socket.data.role = undefined;
    void this.withGame(code, (s) => this.broadcast(s));
  }

  private onConnection(socket: ClientSocket) {
    // Payloads come from untrusted clients: every handler validates its input, a
    // missing ack becomes a no-op, and a thrown error is logged instead of crashing.
    const on = <E extends keyof ClientToServerEvents>(
      event: E,
      handler: (payload: Parameters<ClientToServerEvents[E]>[0], ack: Reply) => unknown,
    ) => {
      socket.on(event, ((payload: never, maybeAck: unknown) => {
        const ack: Reply = typeof maybeAck === 'function' ? (maybeAck as Reply) : () => {};
        Promise.resolve()
          .then(() => handler(payload, ack))
          .catch((err) => {
            console.error(`[${event}]`, err);
            ack({ ok: false, error: 'Server error.' });
          });
      }) as never);
    };

    on('create', async (payload: CreateGamePayload, ack) => {
      const settings = parseSettings(payload?.settings);
      if (!settings) return ack({ ok: false, error: 'Invalid game settings.' });
      const choice = payload.color;
      const color: Color =
        choice === 'w' || choice === 'b' ? choice : randomInt(2) === 0 ? 'w' : 'b';
      const code = await this.newCode();
      const state = createGame(code, settings, Date.now());
      const token = newToken();
      state.players[color] = { token, name: cleanName(payload.name, guestName()) };
      await this.store.save(state);
      ack({ ok: true, code, token });
    });

    on('join', async (payload, ack) => {
      const code = String(payload?.code ?? '').toUpperCase();
      if (!(await this.store.has(code))) return ack({ ok: false, error: 'Game not found.' });
      if (socket.data.code && socket.data.code !== code) this.leaveCurrent(socket);

      const joined = await this.withGame(code, (state) => {
        // A socket that already holds a seat here (e.g. a duplicate join) keeps it.
        const heldSeat = socket.data.code === code ? socket.data.role : undefined;
        let role: Role = 'spectator';
        let token: string | null = null;
        const seat = (['w', 'b'] as const).find(
          (c) => (payload.token && state.players[c]?.token === payload.token) || c === heldSeat,
        );
        if (seat) {
          role = seat;
          token = state.players[seat]!.token;
        } else {
          const empty = (['w', 'b'] as const).find((c) => !state.players[c]);
          if (empty && state.status === 'waiting') {
            role = empty;
            token = newToken();
            state.players[empty] = {
              token,
              name: cleanName(payload.name, guestName()),
            };
            state.status = 'active';
            state.updatedAt = Date.now();
          }
        }
        socket.data.code = code;
        socket.data.role = role;
        socket.data.name =
          role === 'spectator' ? cleanName(payload.name, 'Spectator') : state.players[role]!.name;
        void socket.join(code);
        if (!this.rooms.has(code)) this.rooms.set(code, new Set());
        this.rooms.get(code)!.add(socket);

        ack({ ok: true, role, token });
        socket.emit('chatHistory', state.chat);
        this.broadcast(state);
        this.scheduleClock(state);
        return true;
      });
      if (!joined) ack({ ok: false, error: 'Game not found.' });
    });

    on('move', async (payload, ack) => {
      const { code, role } = socket.data;
      if (!code || (role !== 'w' && role !== 'b')) return ack({ ok: false, error: 'You are not playing.' });
      const outcome = await this.withGame(code, (state) => {
        const res = applyMove(state, role, payload, Date.now());
        // Broadcast even on failure: a rejected move may have just ended the game on time.
        this.broadcast(state);
        this.scheduleClock(state);
        return res;
      });
      if (!outcome) return ack({ ok: false, error: 'Game not found.' });
      ack(outcome.ok ? { ok: true } : outcome);
    });

    on('flag', async (payload) => {
      const { code, role } = socket.data;
      if (!code || (role !== 'w' && role !== 'b')) return;
      await this.withGame(code, (state) => {
        // Flags are private, so only the flagging player's own sockets hear about it.
        if (toggleFlag(state, role, payload?.square)) this.broadcast(state, role);
      });
    });

    on('resign', async () => {
      const { code, role } = socket.data;
      if (!code || (role !== 'w' && role !== 'b')) return;
      await this.withGame(code, (state) => {
        if (resign(state, role, Date.now())) {
          this.broadcast(state);
          this.scheduleClock(state);
        }
      });
    });

    on('rematch', async () => {
      const { code, role } = socket.data;
      if (!code || (role !== 'w' && role !== 'b')) return;
      await this.withGame(code, (state) => {
        if (state.status !== 'over') return;
        state.rematch[role] = true;
        if (state.rematch.w && state.rematch.b) {
          startRematch(state, Date.now());
          // Seats swap colors, so every connected player's role flips too.
          for (const s of this.rooms.get(code) ?? []) {
            if (s.data.role === 'w' || s.data.role === 'b') s.data.role = s.data.role === 'w' ? 'b' : 'w';
          }
        }
        this.broadcast(state);
        this.scheduleClock(state);
      });
    });

    on('chat', async (payload) => {
      const { code, role } = socket.data;
      if (!code || !role) return;
      const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, MAX_CHAT_LENGTH) : '';
      const now = Date.now();
      if (!text || now - (socket.data.lastChatAt ?? 0) < CHAT_COOLDOWN_MS) return;
      socket.data.lastChatAt = now;
      const message: ChatMessage = { id: ++this.chatSeq, name: socket.data.name ?? 'Anonymous', role, text, at: now };
      await this.withGame(code, (state) => {
        state.chat.push(message);
        if (state.chat.length > CHAT_HISTORY) state.chat.splice(0, state.chat.length - CHAT_HISTORY);
      });
      this.io.to(code).emit('chat', message);
    });

    on('leave', () => this.leaveCurrent(socket));
    socket.on('disconnect', () => this.leaveCurrent(socket));
  }
}
