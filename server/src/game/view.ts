import type { Color, GameView, Role } from '../../../shared/protocol';
import { legalMoves, piecesFromFen, sideToMoveInCheck, turnOf } from './engine';
import type { GameState } from './types';

export interface Presence {
  connected: Record<Color, boolean>;
  spectators: number;
}

/**
 * The only path from GameState to the network. Every field is copied over
 * explicitly (never spread) so a new secret field on GameState can't leak by
 * accident. During play this omits: the mine list, the other player's flags,
 * and every seat token.
 */
export function buildView(state: GameState, role: Role, presence: Presence, now: number): GameView {
  const turn = turnOf(state);
  const clock = state.clock;
  const running = state.status === 'active' && clock?.turnStartedAt != null ? turn : null;
  const remaining = (c: Color) =>
    clock ? Math.max(0, clock[c] - (running === c ? now - clock.turnStartedAt! : 0)) : 0;
  const player = (c: Color) =>
    state.players[c] ? { name: state.players[c]!.name, connected: presence.connected[c] } : null;

  return {
    code: state.code,
    round: state.round,
    settings: { ...state.settings },
    status: state.status,
    result: state.result ? { ...state.result } : null,
    turn,
    inCheck: sideToMoveInCheck(state.fen),
    pieces: piecesFromFen(state.fen),
    revealed: { ...state.revealed },
    detonated: [...state.detonated],
    mines: state.status === 'over' ? [...state.mines] : null,
    lastMove: state.moves.length
      ? { from: state.moves.at(-1)!.from, to: state.moves.at(-1)!.to }
      : null,
    moves: state.moves.map((m) => ({ ...m, explosions: m.explosions.map((e) => ({ ...e })) })),
    lost: { w: state.lost.w.map((p) => ({ ...p })), b: state.lost.b.map((p) => ({ ...p })) },
    players: { w: player('w'), b: player('b') },
    spectators: presence.spectators,
    clock: clock ? { w: remaining('w'), b: remaining('b'), running } : null,
    rematch: { ...state.rematch },
    you: {
      role,
      flags: role === 'spectator' ? [] : [...state.flags[role]],
    },
    legalMoves: role === turn ? legalMoves(state) : {},
  };
}
