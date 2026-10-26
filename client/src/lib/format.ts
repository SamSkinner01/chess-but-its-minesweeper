import type { Color, GameView } from '../../../shared/protocol';

export const colorName = (c: Color) => (c === 'w' ? 'White' : 'Black');
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) return `0:0${(clamped / 1000).toFixed(1)}`;
  const total = Math.ceil(clamped / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Headline and detail line for a finished game. */
export function describeResult(view: GameView): { title: string; detail: string } {
  const result = view.result!;
  const winner = result.winner;
  const loser = winner ? other(winner) : view.turn;
  const title = winner ? `${colorName(winner)} wins` : 'Draw';
  const detail: Record<typeof result.reason, string> = {
    checkmate: 'by checkmate',
    mine: `${colorName(loser)}’s king stepped on a mine`,
    exposed: `${colorName(loser)}’s explosion left their own king in check`,
    resign: `${colorName(loser)} resigned`,
    timeout: winner
      ? `${colorName(loser)} ran out of time`
      : `${colorName(loser)} ran out of time, but ${colorName(other(loser))} can’t mate`,
    stalemate: 'by stalemate',
    insufficient: 'by insufficient material',
    threefold: 'by threefold repetition',
    'fifty-move': 'by the fifty-move rule',
  };
  return { title, detail: detail[result.reason] };
}
