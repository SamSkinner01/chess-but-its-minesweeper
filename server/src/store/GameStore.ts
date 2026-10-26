import type { GameState } from '../game/types';

/**
 * Persistence boundary. Async on purpose so a Redis or Postgres implementation
 * can drop in without touching game logic: GameState is plain JSON, so
 * get/save can be JSON.parse/JSON.stringify against a key such as `game:<code>`.
 */
export interface GameStore {
  get(code: string): Promise<GameState | undefined>;
  save(state: GameState): Promise<void>;
  delete(code: string): Promise<void>;
  has(code: string): Promise<boolean>;
}

export class MemoryGameStore implements GameStore {
  private games = new Map<string, GameState>();
  private sweeper: NodeJS.Timeout;

  /** Games untouched for `ttlMs` are dropped (Redis would use EXPIRE instead). */
  constructor(private ttlMs = 24 * 60 * 60 * 1000) {
    this.sweeper = setInterval(() => this.sweep(Date.now()), 10 * 60 * 1000);
    this.sweeper.unref();
  }

  async get(code: string) {
    return this.games.get(code);
  }

  async save(state: GameState) {
    this.games.set(state.code, state);
  }

  async delete(code: string) {
    this.games.delete(code);
  }

  async has(code: string) {
    return this.games.has(code);
  }

  sweep(now: number) {
    for (const [code, game] of this.games) {
      if (now - game.updatedAt > this.ttlMs) this.games.delete(code);
    }
  }
}
