import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage, Color, GameView, LostPiece, PieceCode } from '../../../shared/protocol';
import { formatClock, other } from '../lib/format';
import { MineIcon, PieceImg } from './Icons';

const PIECE_ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4, k: 5 } as const;
const PIECE_VALUE = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 } as const;

function sortPieces(pieces: LostPiece[]) {
  return [...pieces].sort((a, b) => PIECE_ORDER[a.type] - PIECE_ORDER[b.type]);
}

/** Remaining time for one side, ticking locally between server updates. */
function useClock(view: GameView, receivedAt: number, color: Color) {
  const [, tick] = useState(0);
  const running = view.clock?.running === color;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [running]);
  if (!view.clock) return null;
  return view.clock[color] - (running ? Date.now() - receivedAt : 0);
}

export function PlayerBar(props: { view: GameView; color: Color; receivedAt: number }) {
  const { view, color, receivedAt } = props;
  const player = view.players[color];
  const remaining = useClock(view, receivedAt, color);
  const isYou = view.you.role === color;
  const toMove = view.status === 'active' && view.turn === color;
  // Pieces this side took from the opponent, and pieces this side lost to mines.
  const captured = sortPieces(view.lost[other(color)].filter((p) => p.cause === 'capture'));
  const blownUp = sortPieces(view.lost[color].filter((p) => p.cause === 'mine'));
  const material = (c: Color) =>
    Object.values(view.pieces)
      .filter((p) => p![0] === c)
      .reduce((sum, p) => sum + PIECE_VALUE[p![1].toLowerCase() as keyof typeof PIECE_VALUE], 0);
  const lead = material(color) - material(other(color));

  return (
    <div className={`player-bar${toMove ? ' to-move' : ''}`}>
      <div className="player-id">
        <span className={`swatch ${color}`} aria-hidden="true" />
        <span className="player-name">
          {player ? player.name : <em>Waiting…</em>}
          {isYou && <span className="you-tag">you</span>}
        </span>
        {player && !player.connected && <span className="offline">offline</span>}
      </div>
      <div className="player-material">
        {captured.map((p, i) => (
          <PieceImg key={`c${i}`} code={`${other(color)}${p.type.toUpperCase()}` as PieceCode} className="mini" />
        ))}
        {lead > 0 && <span className="lead">+{lead}</span>}
        {blownUp.length > 0 && (
          <span className="blown" title="Lost to mines">
            <MineIcon className="mini-mine" />
            {blownUp.map((p, i) => (
              <PieceImg key={`m${i}`} code={`${color}${p.type.toUpperCase()}` as PieceCode} className="mini" />
            ))}
          </span>
        )}
      </div>
      {remaining !== null && (
        <div className={`clock${toMove && view.clock?.running ? ' running' : ''}${remaining < 30_000 ? ' low' : ''}`}>
          {formatClock(remaining)}
        </div>
      )}
    </div>
  );
}

export function MoveList({ view }: { view: GameView }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.moves.length]);

  const rows: { n: number; w?: GameView['moves'][number]; b?: GameView['moves'][number] }[] = [];
  for (const m of view.moves) {
    const n = Math.ceil(m.ply / 2);
    if (m.color === 'w' || !rows.length) rows.push({ n });
    rows[rows.length - 1][m.color] = m;
  }

  const cell = (m?: GameView['moves'][number]) =>
    m ? (
      <span className={`mv${m.ply === view.moves.length ? ' current' : ''}${m.explosions.length ? ' boom-mv' : ''}`}>
        {m.san}
        {m.explosions.length > 0 && (
          <span className="mv-boom" title={`Mine! ${m.explosions.length > 1 ? 'Two pieces' : 'The piece'} blew up`}>
            💥
          </span>
        )}
      </span>
    ) : (
      <span className="mv" />
    );

  return (
    <section className="card moves-card">
      <h2>Moves</h2>
      {rows.length === 0 ? (
        <p className="muted small">No moves yet.</p>
      ) : (
        <ol className="moves" ref={listRef}>
          {rows.map((r) => (
            <li key={r.n}>
              <span className="mv-n">{r.n}.</span>
              {cell(r.w)}
              {cell(r.b)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Chat(props: { messages: ChatMessage[]; onSend: (text: string) => void; maxLength: number }) {
  const { messages, onSend, maxLength } = props;
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <section className="card chat-card">
      <h2>Chat</h2>
      <div className="chat-log" ref={listRef} aria-live="polite">
        {messages.length === 0 && <p className="muted small">Say hi to your opponent.</p>}
        {messages.map((m) => (
          <p key={m.id} className="chat-line">
            <span className={`chat-name ${m.role}`}>
              {m.name}
              {m.role === 'spectator' ? ' (watching)' : ''}
            </span>{' '}
            {m.text}
          </p>
        ))}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          maxLength={maxLength}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message"
          aria-label="Chat message"
        />
        <button type="submit" className="btn small" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
