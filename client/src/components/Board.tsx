import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Color, GameView, MovePayload, PieceCode, Square } from '../../../shared/protocol';
import { unlockAudio } from '../lib/sound';
import { FlagIcon, MineIcon, PieceImg } from './Icons';

export interface Boom {
  id: string;
  square: Square;
}

interface Props {
  view: GameView;
  orientation: Color;
  flagMode: boolean;
  kingGuard: boolean;
  booms: Boom[];
  shaking: boolean;
  onMove: (move: MovePayload) => void;
  onFlag: (square: Square) => void;
  onNotice: (message: string) => void;
  overlay?: ReactNode;
}

interface Press {
  square: Square;
  x: number;
  y: number;
  pointerId: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  longPressed: boolean;
  dragging: boolean;
}

const LONG_PRESS_MS = 450;
const DRAG_THRESHOLD_PX = 6;

function squareAt(x: number, y: number): Square | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-square]');
  return el?.dataset.square ?? null;
}

export function Board(props: Props) {
  const { view, orientation, flagMode, kingGuard, booms, shaking, onMove, onFlag, onNotice, overlay } = props;
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<{ from: Square; x: number; y: number } | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const press = useRef<Press | null>(null);
  const lastLongPress = useRef(0);

  const me = view.you.role === 'spectator' ? null : view.you.role;
  const flags = useMemo(() => new Set(view.you.flags), [view.you.flags]);
  const detonated = useMemo(() => new Set(view.detonated), [view.detonated]);
  const mines = useMemo(() => new Set(view.mines ?? []), [view.mines]);
  const targets = (selected && view.legalMoves[selected]) || [];

  const squares = useMemo(() => {
    const files = orientation === 'w' ? 'abcdefgh' : 'hgfedcba';
    const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    return ranks.flatMap((r) => [...files].map((f) => `${f}${r}`));
  }, [orientation]);

  const checkedKing = useMemo(() => {
    if (!view.inCheck) return null;
    return Object.entries(view.pieces).find(([, p]) => p === `${view.turn}K`)?.[0] ?? null;
  }, [view.inCheck, view.pieces, view.turn]);

  // A new position invalidates any half-finished selection.
  useEffect(() => {
    setSelected(null);
    setPromotion(null);
  }, [view.moves.length, view.round]);

  const isCovered = (sq: Square) => !(sq in view.revealed) && !detonated.has(sq);
  const isMine = (sq: Square) => !!me && view.pieces[sq]?.[0] === me;

  function toggleFlag(sq: Square) {
    if (!me || view.status === 'over') return;
    if (!isCovered(sq)) return onNotice('Only unrevealed squares can be flagged.');
    onFlag(sq);
  }

  function tryMove(from: Square, to: Square) {
    const piece = view.pieces[from];
    if (!piece || !(view.legalMoves[from] ?? []).includes(to)) return;
    if (kingGuard && piece[1] === 'K' && flags.has(to)) {
      onNotice('King guard is on: your king won’t step onto your own flags.');
      return;
    }
    if (piece[1] === 'P' && (to[1] === '8' || to[1] === '1')) {
      setPromotion({ from, to });
      return;
    }
    setSelected(null);
    onMove({ from, to });
  }

  function tap(sq: Square) {
    if (flagMode) return toggleFlag(sq);
    if (selected && targets.includes(sq)) return tryMove(selected, sq);
    if (isMine(sq)) return setSelected(selected === sq ? null : sq);
    setSelected(null);
  }

  // Pointer handling covers mouse, touch and pen: tap to select/move, drag to move,
  // long-press (touch) or right-click (mouse) to flag.
  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.button !== 0 || promotion) return;
      unlockAudio();
      const sq = squareAt(e.clientX, e.clientY);
      if (!sq) return;
      const p: Press = {
        square: sq,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        timer: undefined,
        longPressed: false,
        dragging: false,
      };
      if (e.pointerType !== 'mouse') {
        p.timer = setTimeout(() => {
          p.longPressed = true;
          lastLongPress.current = Date.now();
          navigator.vibrate?.(25);
          toggleFlag(sq);
        }, LONG_PRESS_MS);
      }
      press.current = p;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId || p.longPressed) return;
      if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD_PX) {
        clearTimeout(p.timer);
        if (!flagMode && isMine(p.square)) {
          p.dragging = true;
          setSelected(p.square);
        }
      }
      if (p.dragging) setDrag({ from: p.square, x: e.clientX, y: e.clientY });
    },
    onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      press.current = null;
      clearTimeout(p.timer);
      if (p.longPressed) return;
      if (p.dragging) {
        setDrag(null);
        const to = squareAt(e.clientX, e.clientY);
        if (to && to !== p.square) tryMove(p.square, to);
        return;
      }
      tap(p.square);
    },
    onPointerCancel() {
      clearTimeout(press.current?.timer);
      press.current = null;
      setDrag(null);
    },
    onContextMenu(e: React.MouseEvent<HTMLDivElement>) {
      e.preventDefault();
      // Android fires contextmenu after a long-press we already handled.
      if (Date.now() - lastLongPress.current < 1000) return;
      const sq = squareAt(e.clientX, e.clientY);
      if (sq) toggleFlag(sq);
    },
  };

  const position = (sq: Square): CSSProperties => {
    const i = squares.indexOf(sq);
    return { left: `${(i % 8) * 12.5}%`, top: `${Math.floor(i / 8) * 12.5}%` };
  };

  return (
    <div className={`board-frame${shaking ? ' shake' : ''}`}>
      <div className={`board${flagMode ? ' flag-mode' : ''}`} {...handlers}>
        {squares.map((sq, i) => {
          const fileIdx = 'abcdefgh'.indexOf(sq[0]);
          const rank = Number(sq[1]);
          const light = (fileIdx + rank) % 2 === 0;
          const piece = view.pieces[sq];
          const count = view.revealed[sq];
          const crater = detonated.has(sq);
          const covered = isCovered(sq);
          const target = targets.includes(sq);
          const blocked = target && kingGuard && view.pieces[selected!]?.[1] === 'K' && flags.has(sq);
          const cls = [
            'sq',
            light ? 'light' : 'dark',
            covered ? 'covered' : 'open',
            crater && 'crater',
            (view.lastMove?.from === sq || view.lastMove?.to === sq) && 'last',
            selected === sq && 'selected',
            checkedKing === sq && 'check',
            (isMine(sq) && !!view.legalMoves[sq] && !flagMode) && 'movable',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div key={sq} data-square={sq} className={cls}>
              {count !== undefined && count > 0 && (
                <span className={`num n${count}${piece ? ' corner' : ''}`}>{count}</span>
              )}
              {i % 8 === 0 && <span className="coord rank">{rank}</span>}
              {i >= 56 && <span className="coord file">{sq[0]}</span>}
              {crater && <MineIcon className="mine detonated" />}
              {!crater && mines.has(sq) && <MineIcon className={`mine unexploded${piece ? ' corner' : ''}`} />}
              {flags.has(sq) && covered && <FlagIcon className={`flag${piece ? ' corner' : ''}`} />}
              {piece && (
                <PieceImg code={piece} className={`piece${drag?.from === sq ? ' lifted' : ''}`} />
              )}
              {target && <span className={`hint${blocked ? ' blocked' : piece ? ' capture' : ''}`} />}
            </div>
          );
        })}

        <div className="fx-layer">
          {booms.map((b) => (
            <div key={b.id} className="boom" style={position(b.square)}>
              <span className="boom-flash" />
              <span className="boom-ring" />
              <span className="boom-smoke" />
              {Array.from({ length: 12 }, (_, k) => (
                <span
                  key={k}
                  className="spark"
                  style={{ '--a': `${k * 30 + (k % 3) * 9}deg`, '--d': 0.9 + (k % 4) * 0.28 } as CSSProperties}
                />
              ))}
            </div>
          ))}
        </div>

        {promotion && me && (
          <div className="promotion" onPointerDown={(e) => e.stopPropagation()}>
            <div className="promotion-card" role="dialog" aria-label="Choose promotion piece">
              {(['q', 'r', 'b', 'n'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    onMove({ ...promotion, promotion: t });
                    setPromotion(null);
                    setSelected(null);
                  }}
                >
                  <PieceImg code={`${me}${t.toUpperCase()}` as PieceCode} />
                </button>
              ))}
              <button type="button" className="promotion-cancel" onClick={() => setPromotion(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {overlay}
      </div>

      {drag && view.pieces[drag.from] && (
        <PieceImg
          code={view.pieces[drag.from]!}
          className="drag-ghost"
          style={{ left: drag.x, top: drag.y }}
        />
      )}
    </div>
  );
}
