import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_CHAT_LENGTH,
  type ChatMessage,
  type Color,
  type GameView,
  type MovePayload,
  type Square,
} from '../../../shared/protocol';
import { colorName, describeResult, other } from '../lib/format';
import { playExplosion, playMove, setMuted } from '../lib/sound';
import { socket } from '../lib/socket';
import { load, store, tokenKey } from '../lib/storage';
import { Board, type Boom } from './Board';
import { FlagIcon, MineIcon } from './Icons';
import { Chat, MoveList, PlayerBar } from './Panels';

interface Props {
  code: string;
  navigate: (to: string) => void;
}

function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 2800);
  }, []);
  return [notice, show] as const;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt('Copy this link:', text);
        }
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

export function GamePage({ code, navigate }: Props) {
  const [view, setView] = useState<GameView | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [booms, setBooms] = useState<Boom[]>([]);
  const [shaking, setShaking] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [flagMode, setFlagMode] = useState(false);
  const [kingGuard, setKingGuard] = useState(() => load('mc:kingGuard') === '1');
  const [muted, setMutedState] = useState(() => load('mc:muted') === '1');
  const [flipped, setFlipped] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [notice, showNotice] = useNotice();
  const prev = useRef<GameView | null>(null);

  useEffect(() => setMuted(muted), [muted]);

  useEffect(() => {
    const join = () => {
      const token = load(tokenKey(code)) ?? undefined;
      socket.emit('join', { code, token, name: load('mc:name') ?? '' }, (res) => {
        if (!res.ok) return setError(res.error);
        setError(null);
        if (res.token) store(tokenKey(code), res.token);
      });
    };

    const onState = (next: GameView) => {
      const before = prev.current;
      prev.current = next;
      setView(next);
      setReceivedAt(Date.now());
      // Animate only moves that happened while we were watching, not on (re)load.
      if (!before || before.round !== next.round || next.moves.length <= before.moves.length) return;
      const fresh = next.moves.slice(before.moves.length);
      const newBooms = fresh.flatMap((m) =>
        m.explosions.map((e) => ({ id: `${next.round}-${m.ply}-${e.square}`, square: e.square })),
      );
      if (newBooms.length) {
        playExplosion();
        setBooms((b) => [...b, ...newBooms]);
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
        setTimeout(() => setBooms((b) => b.filter((x) => !newBooms.some((n) => n.id === x.id))), 1500);
      } else {
        const lostBefore = before.lost.w.length + before.lost.b.length;
        playMove(next.lost.w.length + next.lost.b.length > lostBefore);
      }
    };
    const onChatHistory = (messages: ChatMessage[]) => setChat(messages);
    const onChat = (message: ChatMessage) => setChat((c) => [...c, message].slice(-100));
    const onConnect = () => {
      setConnected(true);
      join();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('state', onState);
    socket.on('chatHistory', onChatHistory);
    socket.on('chat', onChat);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) join();
    return () => {
      socket.off('state', onState);
      socket.off('chatHistory', onChatHistory);
      socket.off('chat', onChat);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.emit('leave');
    };
  }, [code]);

  const sendMove = useCallback(
    (move: MovePayload) => {
      socket.emit('move', move, (res) => {
        if (!res.ok) showNotice(res.error);
      });
    },
    [showNotice],
  );
  const sendFlag = useCallback((square: Square) => socket.emit('flag', { square }), []);

  if (error) {
    return (
      <main className="page center-page">
        <section className="card narrow">
          <h1>Game not available</h1>
          <p className="muted">{error} The link may be wrong, or the game expired.</p>
          <button type="button" className="btn primary" onClick={() => navigate('/')}>
            Back to lobby
          </button>
        </section>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="page center-page">
        <p className="muted">{connected ? 'Joining game…' : 'Connecting…'}</p>
      </main>
    );
  }

  const role = view.you.role;
  const isPlayer = role !== 'spectator';
  const base: Color = role === 'b' ? 'b' : 'w';
  const orientation = flipped ? other(base) : base;
  const link = `${window.location.origin}/g/${view.code}`;
  const minesLeft = view.settings.mines - view.detonated.length;

  let statusTitle: string;
  let statusDetail = '';
  if (view.status === 'waiting') {
    statusTitle = 'Waiting for an opponent';
    statusDetail = 'Share the link to start.';
  } else if (view.status === 'active') {
    statusTitle = isPlayer ? (view.turn === role ? 'Your move' : 'Opponent’s move') : `${colorName(view.turn)} to move`;
    if (view.inCheck) statusDetail = `${colorName(view.turn)} is in check!`;
    else if (!view.moves.length && view.clock) statusDetail = 'Clocks start after White’s first move.';
  } else {
    ({ title: statusTitle, detail: statusDetail } = describeResult(view));
  }

  const iWantRematch = isPlayer && view.rematch[role];
  const theyWantRematch = isPlayer && view.rematch[other(role)];

  return (
    <div className="page game-page">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => navigate('/')}>
          <MineIcon className="brand-mine" /> Minefield Chess
        </button>
        <div className="room">
          <span className="muted small">Room</span>
          <code className="room-code">{view.code}</code>
          <CopyButton text={link} label="Copy link" />
        </div>
      </header>

      {!connected && <div className="banner">Connection lost — reconnecting…</div>}

      <main className="game-layout">
        <section className="board-col">
          <PlayerBar view={view} color={other(orientation)} receivedAt={receivedAt} />
          <Board
            view={view}
            orientation={orientation}
            flagMode={flagMode}
            kingGuard={kingGuard}
            booms={booms}
            shaking={shaking}
            onMove={sendMove}
            onFlag={sendFlag}
            onNotice={showNotice}
            overlay={
              view.status === 'waiting' && (
                <div className="board-overlay">
                  <div className="overlay-card">
                    <h2>Invite a friend</h2>
                    <p className="muted small">Send them this link. The game starts when they join.</p>
                    <code className="share-link">{link}</code>
                    <CopyButton text={link} label="Copy invite link" />
                  </div>
                </div>
              )
            }
          />
          <PlayerBar view={view} color={orientation} receivedAt={receivedAt} />

          <div className="board-tools">
            {isPlayer && (
              <>
                <button
                  type="button"
                  className={`tool${flagMode ? ' on' : ''}`}
                  aria-pressed={flagMode}
                  onClick={() => setFlagMode((f) => !f)}
                  title="When on, tapping a square places or removes a flag"
                >
                  <FlagIcon className="tool-icon" /> Flag mode
                </button>
                <button
                  type="button"
                  className={`tool${kingGuard ? ' on' : ''}`}
                  aria-pressed={kingGuard}
                  onClick={() => {
                    store('mc:kingGuard', kingGuard ? '0' : '1');
                    setKingGuard(!kingGuard);
                  }}
                  title="When on, your king can't move onto squares you flagged"
                >
                  <span aria-hidden="true">🛡️</span> King guard
                </button>
              </>
            )}
            <button type="button" className="tool" onClick={() => setFlipped((f) => !f)}>
              <span aria-hidden="true">⇅</span> Flip
            </button>
            <button
              type="button"
              className={`tool${muted ? '' : ' on'}`}
              aria-pressed={!muted}
              onClick={() => {
                store('mc:muted', muted ? '0' : '1');
                setMutedState(!muted);
              }}
            >
              <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span> Sound
            </button>
          </div>
          {isPlayer && view.status !== 'over' && (
            <p className="hint-text muted small">Right-click or long-press a hidden square to flag it. Only you can see your flags.</p>
          )}
        </section>

        <aside className="side-col">
          <section className={`card status-card ${view.status}`}>
            <div className="status-head">
              <h1 className="status-title">{statusTitle}</h1>
              {statusDetail && <p className="status-detail">{statusDetail}</p>}
            </div>
            <div className="stats">
              <span className="stat" title="Mines that haven't gone off yet">
                <MineIcon className="stat-icon" />
                {minesLeft} of {view.settings.mines} hidden
              </span>
              {isPlayer && (
                <span className="stat" title="Your private flags">
                  <FlagIcon className="stat-icon" />
                  {view.you.flags.length} flagged
                </span>
              )}
              <span className="stat muted">
                {view.settings.mineZone === 'middle' ? 'Middle ranks' : 'Anywhere'} ·{' '}
                {view.settings.timeControl ? `${view.settings.timeControl} min` : 'No clock'}
                {view.spectators > 0 && ` · ${view.spectators} watching`}
              </span>
            </div>
            <div className="actions">
              {isPlayer && view.status === 'active' && (
                <button
                  type="button"
                  className={`btn${confirmResign ? ' danger' : ''}`}
                  onClick={() => {
                    if (confirmResign) {
                      socket.emit('resign');
                      setConfirmResign(false);
                    } else {
                      setConfirmResign(true);
                      setTimeout(() => setConfirmResign(false), 3000);
                    }
                  }}
                >
                  {confirmResign ? 'Click again to resign' : 'Resign'}
                </button>
              )}
              {isPlayer && view.status === 'over' && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={iWantRematch}
                  onClick={() => socket.emit('rematch')}
                >
                  {iWantRematch ? 'Waiting for opponent…' : theyWantRematch ? 'Accept rematch' : 'Rematch'}
                </button>
              )}
              {view.status === 'over' && (
                <button type="button" className="btn" onClick={() => navigate('/')}>
                  New game
                </button>
              )}
            </div>
            {theyWantRematch && !iWantRematch && <p className="small accent">Your opponent wants a rematch (colors swap).</p>}
          </section>

          <MoveList view={view} />
          <Chat messages={chat} maxLength={MAX_CHAT_LENGTH} onSend={(text) => socket.emit('chat', { text })} />
        </aside>
      </main>

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
