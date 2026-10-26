import { Chess, type Move, type Square as ChessSquare } from 'chess.js';
import type {
  Color,
  Explosion,
  GameResult,
  GameSettings,
  MovePayload,
  MoveRecord,
  PieceCode,
  PieceType,
  Square,
} from '../../../shared/protocol';
import { isSquare, placeMines, revealSafe } from './mines';
import type { GameState } from './types';

export const START_FEN = new Chess().fen();

type Rand = (max: number) => number;

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function turnOf(state: GameState): Color {
  return state.fen.split(' ')[1] as Color;
}

/** FEN without the move clocks: identifies a position for repetition. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function piecesFromFen(fen: string): Partial<Record<Square, PieceCode>> {
  const out: Partial<Record<Square, PieceCode>> = {};
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        out[`${'abcdefgh'[file]}${rank}`] = `${color}${ch.toUpperCase()}` as PieceCode;
        file++;
      }
    }
  });
  return out;
}

/** Whether the side to move is in check. Safe to call on a finished game with a king missing. */
export function sideToMoveInCheck(fen: string): boolean {
  const pieces = Object.values(piecesFromFen(fen));
  if (!pieces.includes('wK') || !pieces.includes('bK')) return false;
  try {
    return new Chess(fen, { skipValidation: true }).inCheck();
  } catch {
    return false;
  }
}

function initialClock(settings: GameSettings) {
  if (!settings.timeControl) return null;
  const ms = settings.timeControl * 60_000;
  return { w: ms, b: ms, turnStartedAt: null };
}

export function createGame(code: string, settings: GameSettings, now: number, rand?: Rand): GameState {
  return {
    code,
    round: 1,
    createdAt: now,
    updatedAt: now,
    settings,
    status: 'waiting',
    result: null,
    fen: START_FEN,
    mines: placeMines(settings.mines, settings.mineZone, rand),
    detonated: [],
    revealed: {},
    moves: [],
    lost: { w: [], b: [] },
    positionCounts: { [positionKey(START_FEN)]: 1 },
    players: { w: null, b: null },
    flags: { w: [], b: [] },
    clock: initialClock(settings),
    rematch: { w: false, b: false },
    chat: [],
  };
}

/** Resets the board for another round in the same room, with colors swapped and fresh mines. */
export function startRematch(state: GameState, now: number, rand?: Rand): void {
  const fresh = createGame(state.code, state.settings, now, rand);
  Object.assign(state, {
    ...fresh,
    round: state.round + 1,
    createdAt: state.createdAt,
    status: 'active',
    players: { w: state.players.b, b: state.players.w },
    chat: state.chat,
  });
}

/**
 * Legal moves are pure chess and never depend on where mines are; otherwise the
 * move list itself would leak mine positions.
 */
export function legalMoves(state: GameState): Partial<Record<Square, Square[]>> {
  if (state.status !== 'active') return {};
  const out: Partial<Record<Square, Square[]>> = {};
  for (const m of new Chess(state.fen).moves({ verbose: true })) {
    const list = (out[m.from] ??= []);
    if (!list.includes(m.to)) list.push(m.to); // promotions repeat the same squares
  }
  return out;
}

function endGame(state: GameState, result: GameResult, now: number): void {
  state.status = 'over';
  state.result = result;
  if (state.clock) state.clock.turnStartedAt = null;
  state.updatedAt = now;
}

function hasOnlyKing(fen: string, color: Color): boolean {
  return Object.values(piecesFromFen(fen)).every((p) => !p || p[0] !== color || p === `${color}K`);
}

/** Flags the side to move if their time has run out. Returns true if the game ended. */
export function checkTimeout(state: GameState, now: number): boolean {
  const clock = state.clock;
  if (state.status !== 'active' || !clock || clock.turnStartedAt === null) return false;
  const mover = turnOf(state);
  if (clock[mover] - (now - clock.turnStartedAt) > 0) return false;
  clock[mover] = 0;
  // Standard rule: running out of time is a draw if the opponent can't possibly mate.
  const winner = hasOnlyKing(state.fen, other(mover)) ? null : other(mover);
  endGame(state, { winner, reason: 'timeout' }, now);
  return true;
}

export function resign(state: GameState, color: Color, now: number): boolean {
  if (state.status !== 'active') return false;
  endGame(state, { winner: other(color), reason: 'resign' }, now);
  return true;
}

export function toggleFlag(state: GameState, color: Color, square: Square): boolean {
  if (!isSquare(square) || square in state.revealed || state.detonated.includes(square)) return false;
  const flags = state.flags[color];
  const i = flags.indexOf(square);
  if (i >= 0) flags.splice(i, 1);
  else flags.push(square);
  return true;
}

function setHalfmoveClock(fen: string, value: number): string {
  const parts = fen.split(' ');
  parts[4] = String(value);
  return parts.join(' ');
}

function kingSquare(chess: Chess, color: Color): Square | null {
  for (const row of chess.board()) {
    for (const cell of row) if (cell && cell.type === 'k' && cell.color === color) return cell.square;
  }
  return null;
}

export type MoveOutcome = { ok: true; record: MoveRecord } | { ok: false; error: string };

export function applyMove(state: GameState, color: Color, input: MovePayload, now: number): MoveOutcome {
  if (state.status !== 'active') return { ok: false, error: 'The game is not in progress.' };
  if (turnOf(state) !== color) return { ok: false, error: 'It is not your turn.' };
  if (!isSquare(input?.from) || !isSquare(input?.to)) return { ok: false, error: 'Invalid square.' };
  if (input.promotion !== undefined && !['q', 'r', 'b', 'n'].includes(input.promotion)) {
    return { ok: false, error: 'Invalid promotion piece.' };
  }
  if (checkTimeout(state, now)) return { ok: false, error: 'Your time ran out.' };

  const chess = new Chess(state.fen);
  let move: Move;
  try {
    move = chess.move({ from: input.from, to: input.to, promotion: input.promotion ?? 'q' });
  } catch {
    return { ok: false, error: 'Illegal move.' };
  }

  const opponent = other(color);
  if (move.captured) state.lost[opponent].push({ type: move.captured, cause: 'capture' });

  // Every square a piece lands on is "stepped on": the destination, plus the
  // rook's square when castling. Squares merely passed over are not.
  const landings: { square: Square; piece: PieceType }[] = [
    { square: move.to, piece: move.promotion ?? move.piece },
  ];
  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    landings.push({ square: `${move.isKingsideCastle() ? 'f' : 'd'}${move.to[1]}`, piece: 'r' });
  }

  const mines = new Set(state.mines);
  const explosions: Explosion[] = [];
  let kingExploded = false;
  for (const { square, piece } of landings) {
    if (mines.has(square) && !state.detonated.includes(square)) {
      // Boom. The mine is used up; its square stays marked publicly as a crater.
      state.detonated.push(square);
      explosions.push({ square, piece, color });
      state.lost[color].push({ type: piece, cause: 'mine' });
      if (piece === 'k') kingExploded = true;
      chess.remove(square as ChessSquare);
    } else {
      revealSafe(square, mines, state.revealed);
    }
  }
  // Flags on squares that are now open are meaningless; drop them.
  for (const c of ['w', 'b'] as const) {
    state.flags[c] = state.flags[c].filter((sq) => !(sq in state.revealed) && !state.detonated.includes(sq));
  }

  // An explosion removes material irreversibly, just like a capture.
  const fen = explosions.length ? setHalfmoveClock(chess.fen(), 0) : chess.fen();
  state.fen = fen;
  const key = positionKey(fen);
  state.positionCounts[key] = (state.positionCounts[key] ?? 0) + 1;

  if (state.clock) {
    if (state.clock.turnStartedAt !== null) state.clock[color] -= now - state.clock.turnStartedAt;
    state.clock.turnStartedAt = now;
  }

  let result: GameResult | null = null;
  let suffix = '';
  if (kingExploded) {
    result = { winner: opponent, reason: 'mine' };
  } else {
    const ownKing = kingSquare(chess, color);
    if (ownKing && chess.isAttacked(ownKing as ChessSquare, opponent)) {
      // The exploding piece was shielding its own king; the opponent would simply take it.
      result = { winner: opponent, reason: 'exposed' };
    } else if (chess.isCheckmate()) {
      result = { winner: color, reason: 'checkmate' };
      suffix = '#';
    } else {
      if (chess.inCheck()) suffix = '+';
      if (chess.isStalemate()) result = { winner: null, reason: 'stalemate' };
      else if (chess.isInsufficientMaterial()) result = { winner: null, reason: 'insufficient' };
      else if (state.positionCounts[key] >= 3) result = { winner: null, reason: 'threefold' };
      else if (Number(fen.split(' ')[4]) >= 100) result = { winner: null, reason: 'fifty-move' };
    }
  }

  const record: MoveRecord = {
    ply: state.moves.length + 1,
    color,
    from: move.from,
    to: move.to,
    // chess.js computed +/# before any explosion; recompute it for the real position.
    san: move.san.replace(/[+#]$/, '') + suffix,
    explosions,
  };
  state.moves.push(record);
  state.updatedAt = now;
  if (result) endGame(state, result, now);
  return { ok: true, record };
}
