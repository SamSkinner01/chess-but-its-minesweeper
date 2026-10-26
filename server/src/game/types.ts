import type {
  ChatMessage,
  Color,
  GameResult,
  GameSettings,
  GameStatus,
  LostPiece,
  MoveRecord,
  Square,
} from '../../../shared/protocol';

export interface PlayerSlot {
  /** Secret that lets a browser reclaim this seat after a refresh. Never sent to other clients. */
  token: string;
  name: string;
}

export interface ClockState {
  w: number;
  b: number;
  /** When the side to move started thinking; null until White's first move. */
  turnStartedAt: number | null;
}

/**
 * Full authoritative game state. Plain JSON on purpose so it can be stored in
 * Redis/Postgres later without changes. Contains secrets (mines, tokens, both
 * players' flags), so it must only ever leave the server through buildView().
 */
export interface GameState {
  code: string;
  round: number;
  createdAt: number;
  updatedAt: number;
  settings: GameSettings;
  status: GameStatus;
  result: GameResult | null;
  fen: string;
  /** SECRET: every mine, including ones that have gone off. */
  mines: Square[];
  detonated: Square[];
  revealed: Record<Square, number>;
  moves: MoveRecord[];
  lost: Record<Color, LostPiece[]>;
  /** Position key (FEN without clocks) -> times seen, for threefold repetition. */
  positionCounts: Record<string, number>;
  players: Record<Color, PlayerSlot | null>;
  /** SECRET per player: each side only ever sees its own flags. */
  flags: Record<Color, Square[]>;
  clock: ClockState | null;
  rematch: Record<Color, boolean>;
  chat: ChatMessage[];
}
