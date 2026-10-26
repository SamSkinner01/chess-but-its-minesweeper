// Types and constants shared by the server and the browser client.
// Everything in here describes what crosses the wire, so nothing secret
// (like mine positions during play) may ever be added to GameView.

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
/** Color + uppercase piece letter, e.g. "wQ" or "bP". */
export type PieceCode = `${Color}${Uppercase<PieceType>}`;
export type Square = string; // "a1" .. "h8"

export type MineZone = 'middle' | 'anywhere';
export type TimeControl = 0 | 5 | 10; // minutes per player, 0 = untimed
export type ColorChoice = Color | 'random';
export type Role = Color | 'spectator';

export const MIN_MINES = 0;
export const MAX_MINES = 12;
export const DEFAULT_MINES = 6;
export const TIME_CONTROLS: readonly TimeControl[] = [0, 5, 10];
export const MAX_NAME_LENGTH = 24;
export const MAX_CHAT_LENGTH = 200;

export interface GameSettings {
  mines: number;
  timeControl: TimeControl;
  mineZone: MineZone;
}

export type GameStatus = 'waiting' | 'active' | 'over';

export type EndReason =
  | 'checkmate'
  | 'mine' // a king stepped on a mine
  | 'exposed' // an explosion left the mover's own king in check
  | 'resign'
  | 'timeout'
  | 'stalemate'
  | 'insufficient'
  | 'threefold'
  | 'fifty-move';

export interface GameResult {
  winner: Color | null; // null = draw
  reason: EndReason;
}

export interface Explosion {
  square: Square;
  piece: PieceType;
  color: Color;
}

export interface MoveRecord {
  ply: number;
  color: Color;
  from: Square;
  to: Square;
  /** SAN with check/mate suffix recomputed after any explosion. */
  san: string;
  explosions: Explosion[];
}

export interface LostPiece {
  type: PieceType;
  cause: 'capture' | 'mine';
}

export interface PlayerInfo {
  name: string;
  connected: boolean;
}

export interface ClockView {
  /** Remaining milliseconds at the moment the server sent this view. */
  w: number;
  b: number;
  /** Whose clock is ticking right now, if any. */
  running: Color | null;
}

/** The redacted, per-viewer picture of a game. Built by server/src/game/view.ts. */
export interface GameView {
  code: string;
  round: number;
  settings: GameSettings;
  status: GameStatus;
  result: GameResult | null;
  turn: Color;
  inCheck: boolean;
  pieces: Partial<Record<Square, PieceCode>>;
  /** Revealed safe squares and their adjacent-mine counts. */
  revealed: Partial<Record<Square, number>>;
  /** Squares whose mine has already gone off (public knowledge). */
  detonated: Square[];
  /** Every mine position, sent only once the game is over. */
  mines: Square[] | null;
  lastMove: { from: Square; to: Square } | null;
  moves: MoveRecord[];
  /** Pieces each color has lost, in order. */
  lost: Record<Color, LostPiece[]>;
  players: Record<Color, PlayerInfo | null>;
  spectators: number;
  clock: ClockView | null;
  rematch: Record<Color, boolean>;
  you: {
    role: Role;
    /** Your private flags. Empty for spectators. */
    flags: Square[];
  };
  /** Legal destinations by origin square; only filled in for the player to move. */
  legalMoves: Partial<Record<Square, Square[]>>;
}

export interface ChatMessage {
  id: number;
  name: string;
  role: Role;
  text: string;
  at: number;
}

// ---- Socket.IO event contracts ----

export type Ack<T> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface CreateGamePayload {
  name: string;
  settings: GameSettings;
  color: ColorChoice;
}

export interface JoinGamePayload {
  code: string;
  token?: string;
  name: string;
}

export interface MovePayload {
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export interface ClientToServerEvents {
  create: (payload: CreateGamePayload, ack: Ack<{ code: string; token: string }>) => void;
  join: (payload: JoinGamePayload, ack: Ack<{ role: Role; token: string | null }>) => void;
  leave: () => void;
  move: (payload: MovePayload, ack: Ack<object>) => void;
  flag: (payload: { square: Square }) => void;
  resign: () => void;
  rematch: () => void;
  chat: (payload: { text: string }) => void;
}

export interface ServerToClientEvents {
  state: (view: GameView) => void;
  chatHistory: (messages: ChatMessage[]) => void;
  chat: (message: ChatMessage) => void;
}
