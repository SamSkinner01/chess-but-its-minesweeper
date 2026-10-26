import { randomInt } from 'node:crypto';
import type { MineZone, Square } from '../../../shared/protocol';

const FILES = 'abcdefgh';

export const ALL_SQUARES: Square[] = [];
for (let rank = 1; rank <= 8; rank++) {
  for (const file of FILES) ALL_SQUARES.push(`${file}${rank}`);
}

export function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

export function neighbors(square: Square): Square[] {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) out.push(`${FILES[nf]}${nr}`);
    }
  }
  return out;
}

/**
 * Squares a mine may be placed on.
 * - middle:   ranks 3-6, i.e. exactly the squares that are empty at the start.
 * - anywhere: any square. A mine under a starting piece lies dormant (the piece
 *   that starts there never "moved onto" it) and arms once that square is vacated,
 *   so it can catch a later arrival, including a piece capturing on that square.
 */
export function mineCandidates(zone: MineZone): Square[] {
  if (zone === 'anywhere') return [...ALL_SQUARES];
  return ALL_SQUARES.filter((sq) => {
    const rank = Number(sq[1]);
    return rank >= 3 && rank <= 6;
  });
}

/** Picks `count` distinct squares with a CSPRNG so layouts can't be predicted. */
export function placeMines(
  count: number,
  zone: MineZone,
  rand: (max: number) => number = randomInt,
): Square[] {
  const pool = mineCandidates(zone);
  const n = Math.max(0, Math.min(count, pool.length));
  // Partial Fisher-Yates shuffle.
  for (let i = 0; i < n; i++) {
    const j = i + rand(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export function adjacentMineCount(square: Square, mines: ReadonlySet<Square>): number {
  return neighbors(square).filter((sq) => mines.has(sq)).length;
}

/**
 * Reveals a safe square and, Minesweeper-style, flood-fills outward from zeros.
 * Counts include mines that have already detonated: those are shown publicly,
 * so a number never changes once revealed. Mutates and returns `revealed`.
 */
export function revealSafe(
  start: Square,
  mines: ReadonlySet<Square>,
  revealed: Record<Square, number>,
): Record<Square, number> {
  const queue: Square[] = [start];
  while (queue.length > 0) {
    const sq = queue.shift()!;
    if (sq in revealed || mines.has(sq)) continue;
    const count = adjacentMineCount(sq, mines);
    revealed[sq] = count;
    if (count === 0) {
      for (const n of neighbors(sq)) if (!(n in revealed)) queue.push(n);
    }
  }
  return revealed;
}
