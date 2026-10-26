import { describe, expect, it } from 'vitest';
import type { Color, MovePayload } from '../../shared/protocol';
import {
  applyMove,
  checkTimeout,
  createGame,
  legalMoves,
  piecesFromFen,
  startRematch,
  toggleFlag,
} from '../src/game/engine';
import { mineCandidates, placeMines, revealSafe } from '../src/game/mines';
import type { GameState } from '../src/game/types';
import { buildView } from '../src/game/view';

const presence = { connected: { w: true, b: true }, spectators: 0 };

function game(opts: { mines?: string[]; fen?: string; zone?: 'middle' | 'anywhere'; time?: 0 | 5 | 10 } = {}) {
  const state = createGame('TEST01', { mines: 0, timeControl: opts.time ?? 0, mineZone: opts.zone ?? 'middle' }, 0);
  state.players.w = { token: 'white-secret', name: 'Alice' };
  state.players.b = { token: 'black-secret', name: 'Bob' };
  state.status = 'active';
  state.mines = opts.mines ?? [];
  if (opts.fen) state.fen = opts.fen;
  return state;
}

function play(state: GameState, color: Color, from: string, to: string, extra: Partial<MovePayload> = {}, now = 0) {
  const res = applyMove(state, color, { from, to, ...extra }, now);
  if (!res.ok) throw new Error(`${from}-${to}: ${res.error}`);
  return res.record;
}

describe('mine placement', () => {
  it('middle zone only uses ranks 3-6', () => {
    expect(mineCandidates('middle')).toHaveLength(32);
    for (let i = 0; i < 50; i++) {
      const mines = placeMines(12, 'middle');
      expect(new Set(mines).size).toBe(12);
      for (const sq of mines) expect(Number(sq[1])).toBeGreaterThanOrEqual(3);
      for (const sq of mines) expect(Number(sq[1])).toBeLessThanOrEqual(6);
    }
  });

  it('anywhere zone can use all 64 squares', () => {
    expect(mineCandidates('anywhere')).toHaveLength(64);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) placeMines(12, 'anywhere').forEach((sq) => seen.add(sq));
    expect([...seen].some((sq) => sq[1] === '1' || sq[1] === '8')).toBe(true);
  });

  it('supports zero mines', () => {
    expect(placeMines(0, 'middle')).toEqual([]);
  });
});

describe('reveal and flood fill', () => {
  it('counts adjacent mines and flood-fills from zeros', () => {
    const mines = new Set(['d4']);
    const revealed = revealSafe('h8', mines, {});
    // Everything but the mine is reachable through zeros on an otherwise empty board.
    expect(Object.keys(revealed)).toHaveLength(63);
    expect(revealed.e5).toBe(1);
    expect(revealed.c3).toBe(1);
    expect(revealed.a1).toBe(0);
    expect('d4' in revealed).toBe(false);
  });

  it('stops at numbered squares', () => {
    const mines = new Set(['c3', 'f3']);
    const revealed = revealSafe('d3', mines, {});
    expect(revealed).toEqual({ d3: 1 });
  });
});

describe('moves and explosions', () => {
  it('legal moves do not depend on mine layout', () => {
    const a = game({ mines: ['e4', 'd5', 'f3'] });
    const b = game({ mines: ['a3', 'h6'] });
    expect(legalMoves(a)).toEqual(legalMoves(b));
  });

  it('reveals the landing square with its count', () => {
    const s = game({ mines: ['d5', 'f5'] });
    play(s, 'w', 'e2', 'e4');
    expect(s.revealed.e4).toBe(2);
    expect(s.detonated).toEqual([]);
  });

  it('removes a piece that steps on a mine and records it', () => {
    const s = game({ mines: ['e4'] });
    const rec = play(s, 'w', 'e2', 'e4');
    expect(rec.explosions).toEqual([{ square: 'e4', piece: 'p', color: 'w' }]);
    expect(piecesFromFen(s.fen).e4).toBeUndefined();
    expect(s.detonated).toEqual(['e4']);
    expect(s.lost.w).toEqual([{ type: 'p', cause: 'mine' }]);
    expect(s.fen.split(' ')[1]).toBe('b');
    expect(s.fen.split(' ')[3]).toBe('-'); // no en passant against a pawn that no longer exists
    // The mine is used up: the next piece to land there is safe.
    play(s, 'b', 'g8', 'f6');
    play(s, 'w', 'd2', 'd3');
    play(s, 'b', 'f6', 'e4');
    expect(piecesFromFen(s.fen).e4).toBe('bN');
  });

  it('ends the game when a king steps on a mine', () => {
    const s = game({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', mines: ['e2'] });
    play(s, 'w', 'e1', 'e2');
    expect(s.status).toBe('over');
    expect(s.result).toEqual({ winner: 'b', reason: 'mine' });
    expect(piecesFromFen(s.fen).e2).toBeUndefined();
  });

  it('loses when an explosion exposes your own king', () => {
    // White rook on e4 shields the king on e1 from the rook on e8; it moves along the pin onto a mine.
    const s = game({ fen: '4r1k1/8/8/8/4R3/8/8/4K3 w - - 0 1', mines: ['e3'] });
    play(s, 'w', 'e4', 'e3');
    expect(s.result).toEqual({ winner: 'b', reason: 'exposed' });
  });

  it('a mating piece that explodes does not deliver mate', () => {
    // Back-rank mate Ra8# — but a8 is mined (zone "anywhere"), so the rook is gone.
    const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const safe = game({ fen });
    expect(play(safe, 'w', 'a1', 'a8').san).toBe('Ra8#');
    expect(safe.result).toEqual({ winner: 'w', reason: 'checkmate' });

    const mined = game({ fen, mines: ['a8'], zone: 'anywhere' });
    const rec = play(mined, 'w', 'a1', 'a8');
    expect(rec.san).toBe('Ra8');
    expect(mined.status).toBe('active');
    expect(mined.result).toBeNull();
  });

  it('capturing onto a mined square still triggers it', () => {
    // Dormant mine under the black knight's starting square b8.
    const s = game({ fen: 'rn2k3/P7/8/8/8/8/8/4K3 w - - 0 1', mines: ['b8'], zone: 'anywhere' });
    const rec = play(s, 'w', 'a7', 'b8', { promotion: 'q' });
    expect(rec.explosions).toEqual([{ square: 'b8', piece: 'q', color: 'w' }]);
    expect(s.lost.b).toEqual([{ type: 'n', cause: 'capture' }]);
    expect(s.lost.w).toEqual([{ type: 'q', cause: 'mine' }]);
    expect(piecesFromFen(s.fen).b8).toBeUndefined();
  });

  it('en passant onto a mine blows up the capturing pawn', () => {
    const s = game({ mines: ['d6'] });
    play(s, 'w', 'e2', 'e4');
    play(s, 'b', 'a7', 'a6');
    play(s, 'w', 'e4', 'e5');
    play(s, 'b', 'd7', 'd5');
    const rec = play(s, 'w', 'e5', 'd6');
    expect(rec.explosions[0]).toMatchObject({ square: 'd6', piece: 'p' });
    const pieces = piecesFromFen(s.fen);
    expect(pieces.d5).toBeUndefined();
    expect(pieces.d6).toBeUndefined();
  });

  it('castling checks the rook landing square too', () => {
    const s = game({ fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', mines: ['f1'], zone: 'anywhere' });
    const rec = play(s, 'w', 'e1', 'g1');
    expect(rec.san).toBe('O-O');
    expect(rec.explosions).toEqual([{ square: 'f1', piece: 'r', color: 'w' }]);
    const pieces = piecesFromFen(s.fen);
    expect(pieces.g1).toBe('wK');
    expect(pieces.f1).toBeUndefined();
  });

  it('rejects moves out of turn and illegal moves', () => {
    const s = game();
    expect(applyMove(s, 'b', { from: 'e7', to: 'e5' }, 0).ok).toBe(false);
    expect(applyMove(s, 'w', { from: 'e2', to: 'e5' }, 0).ok).toBe(false);
    expect(applyMove(s, 'w', { from: 'zz', to: 'e5' } as MovePayload, 0).ok).toBe(false);
  });

  it('declares threefold repetition', () => {
    const s = game();
    for (let i = 0; i < 2; i++) {
      play(s, 'w', 'g1', 'f3');
      play(s, 'b', 'g8', 'f6');
      play(s, 'w', 'f3', 'g1');
      play(s, 'b', 'f6', 'g8');
    }
    expect(s.result).toEqual({ winner: null, reason: 'threefold' });
  });
});

describe('flags', () => {
  it('are private, toggle, and vanish once a square is revealed', () => {
    const s = game({ mines: ['d5'] });
    expect(toggleFlag(s, 'w', 'e4')).toBe(true);
    expect(toggleFlag(s, 'w', 'd5')).toBe(true);
    expect(s.flags.w).toEqual(['e4', 'd5']);
    toggleFlag(s, 'w', 'd5');
    expect(s.flags.w).toEqual(['e4']);
    play(s, 'w', 'e2', 'e4');
    expect(s.flags.w).toEqual([]);
    expect(toggleFlag(s, 'b', 'e4')).toBe(false); // already revealed
  });
});

describe('clocks', () => {
  it('flags the side to move when time runs out', () => {
    const s = game({ time: 5 });
    play(s, 'w', 'e2', 'e4', {}, 1_000); // White's first move is untimed
    expect(s.clock!.w).toBe(300_000);
    expect(checkTimeout(s, 1_000 + 299_000)).toBe(false);
    expect(checkTimeout(s, 1_000 + 300_000)).toBe(true);
    expect(s.result).toEqual({ winner: 'w', reason: 'timeout' });
  });
});

describe('view redaction', () => {
  it('never exposes mines, tokens or the opponent’s flags during play', () => {
    const s = game({ mines: ['c4', 'f5', 'h3'] });
    toggleFlag(s, 'b', 'a6');
    toggleFlag(s, 'w', 'h6');
    const view = buildView(s, 'w', presence, 0);
    const json = JSON.stringify(view);
    expect(view.mines).toBeNull();
    expect(view.you.flags).toEqual(['h6']);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('a6');
    expect(Object.keys(view.legalMoves).length).toBeGreaterThan(0);

    // Strongest check: two games that differ only in hidden mines look byte-identical.
    const other = structuredClone(s);
    other.mines = ['a3', 'b4', 'g6'];
    expect(JSON.stringify(buildView(other, 'w', presence, 0))).toBe(json);

    const spectator = buildView(s, 'spectator', presence, 0);
    expect(spectator.you.flags).toEqual([]);
    expect(spectator.legalMoves).toEqual({});
    expect(buildView(s, 'b', presence, 0).legalMoves).toEqual({});
  });

  it('reveals all mines once the game is over', () => {
    const s = game({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', mines: ['e2', 'a5'] });
    play(s, 'w', 'e1', 'e2');
    expect(buildView(s, 'b', presence, 0).mines).toEqual(['e2', 'a5']);
  });
});

describe('rematch', () => {
  it('swaps colors and lays fresh mines', () => {
    const s = game({ mines: ['e4'] });
    s.settings.mines = 6;
    play(s, 'w', 'e2', 'e4');
    s.status = 'over';
    startRematch(s, 10);
    expect(s.round).toBe(2);
    expect(s.players.w?.name).toBe('Bob');
    expect(s.players.b?.name).toBe('Alice');
    expect(s.mines).toHaveLength(6);
    expect(s.moves).toEqual([]);
    expect(s.status).toBe('active');
  });
});
