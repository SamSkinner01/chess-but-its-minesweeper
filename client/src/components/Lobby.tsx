import { useState, type FormEvent } from 'react';
import {
  DEFAULT_MINES,
  MAX_MINES,
  MAX_NAME_LENGTH,
  MIN_MINES,
  type ColorChoice,
  type GameSettings,
  type MineZone,
  type TimeControl,
} from '../../../shared/protocol';
import { socket } from '../lib/socket';
import { load, store, tokenKey } from '../lib/storage';
import { FlagIcon, MineIcon, PieceImg } from './Icons';

function savedSettings(): GameSettings {
  const fallback: GameSettings = { mines: DEFAULT_MINES, timeControl: 0, mineZone: 'middle' };
  try {
    return { ...fallback, ...JSON.parse(load('mc:settings') ?? '{}') };
  } catch {
    return fallback;
  }
}

function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="field">
      <legend>{props.label}</legend>
      <div className="segmented" role="radiogroup">
        {props.options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            className={props.value === o.value ? 'on' : ''}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Lobby({ navigate }: { navigate: (to: string) => void }) {
  const [name, setName] = useState(() => load('mc:name') ?? '');
  const [settings, setSettings] = useState(savedSettings);
  const [color, setColor] = useState<ColorChoice>('random');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<GameSettings>) => setSettings((s) => ({ ...s, ...patch }));

  function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    store('mc:name', name.trim());
    store('mc:settings', JSON.stringify(settings));
    socket.timeout(8000).emit('create', { name, settings, color }, (err, res) => {
      setBusy(false);
      if (err) return setError('The server did not respond. Is it running?');
      if (!res.ok) return setError(res.error);
      store(tokenKey(res.code), res.token);
      navigate(`/g/${res.code}`);
    });
  }

  function join(e: FormEvent) {
    e.preventDefault();
    // Accept either a bare code or a pasted invite link.
    const code = joinCode.trim().split('/').pop()?.toUpperCase() ?? '';
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return setError('That doesn’t look like a room code.');
    store('mc:name', name.trim());
    navigate(`/g/${code}`);
  }

  return (
    <div className="page lobby">
      <header className="hero">
        <div className="hero-art" aria-hidden="true">
          <div className="sq covered light">
            <PieceImg code="wN" className="piece" />
          </div>
          <div className="sq open dark">
            <span className="num n2">2</span>
          </div>
          <div className="sq covered light">
            <FlagIcon className="flag" />
          </div>
          <div className="sq open dark crater">
            <MineIcon className="mine detonated" />
          </div>
        </div>
        <h1>Minefield Chess</h1>
        <p className="tagline">Real chess. Hidden mines. Every step into the middle of the board is a gamble.</p>
      </header>

      <main className="lobby-grid">
        <form className="card create-card" onSubmit={create}>
          <h2>Create a game</h2>
          <label className="field">
            <span className="legend">Your name</span>
            <input
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder="Anonymous"
              autoComplete="nickname"
            />
          </label>

          <label className="field">
            <span className="legend">
              Mines <strong className="mine-count">{settings.mines}</strong>
            </span>
            <input
              type="range"
              min={MIN_MINES}
              max={MAX_MINES}
              value={settings.mines}
              onChange={(e) => update({ mines: Number(e.target.value) })}
            />
          </label>

          <Segmented<TimeControl>
            label="Time control"
            value={settings.timeControl}
            onChange={(timeControl) => update({ timeControl })}
            options={[
              { value: 0, label: 'None' },
              { value: 5, label: '5 min' },
              { value: 10, label: '10 min' },
            ]}
          />

          <Segmented<MineZone>
            label="Mine zone"
            value={settings.mineZone}
            onChange={(mineZone) => update({ mineZone })}
            options={[
              { value: 'middle', label: 'Middle ranks' },
              { value: 'anywhere', label: 'Anywhere' },
            ]}
          />
          <p className="muted small zone-help">
            {settings.mineZone === 'middle'
              ? 'Mines hide on ranks 3–6, the squares that start empty.'
              : 'Mines can also lie dormant under starting squares. They arm once the piece leaves, so returning to (or capturing on) a home square is risky too.'}
          </p>

          <Segmented<ColorChoice>
            label="Play as"
            value={color}
            onChange={setColor}
            options={[
              { value: 'w', label: 'White' },
              { value: 'random', label: 'Random' },
              { value: 'b', label: 'Black' },
            ]}
          />

          <button type="submit" className="btn primary big" disabled={busy}>
            {busy ? 'Creating…' : 'Create game'}
          </button>
        </form>

        <div className="lobby-side">
          <form className="card join-card" onSubmit={join}>
            <h2>Join a game</h2>
            <div className="join-row">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Room code or link"
                aria-label="Room code or invite link"
                autoCapitalize="characters"
              />
              <button type="submit" className="btn" disabled={!joinCode.trim()}>
                Join
              </button>
            </div>
          </form>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <section className="card rules">
            <h2>How it works</h2>
            <ul>
              <li>Standard chess rules apply: check, mate, castling, en passant, promotion.</li>
              <li>Hidden mines are scattered across the board. Neither player knows where.</li>
              <li>
                Landing on a square reveals it. A mine blows up the piece that landed there; a safe square shows how
                many mines touch it, in classic Minesweeper colors. Zeros open up their neighbours.
              </li>
              <li>If your king steps on a mine, you lose. If a blast leaves your own king in check, you lose too.</li>
              <li>Right-click or long-press to plant private flags. Turn on King guard to keep your king off them.</li>
              <li>The server keeps the mine map secret. Your browser only ever learns what’s been revealed.</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
