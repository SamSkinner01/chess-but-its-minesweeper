# Minefield Chess

Real-time multiplayer chess where the board is a hidden Minesweeper field. Step on a mine and your piece
blows up. Step anywhere else and the square shows how many mines touch it.

- Full chess rules (via [chess.js](https://github.com/jhlywa/chess.js)): check, mate, stalemate, castling,
  en passant, promotion, threefold repetition, fifty-move rule, insufficient material
- Hidden mines with Minesweeper numbers, flood-fill on zeros, explosion animation and sound
- Private flags (right-click, long-press on touch, or "Flag mode"), plus an optional **King guard**
- Shareable room links, reconnect-on-refresh, spectators, rematch (colors swap), in-game chat
- Server-authoritative clocks (none / 5 / 10 min)
- React + TypeScript client, Node + Express + Socket.IO server

## Run locally

Requires Node 20+.

```bash
npm install && npm run dev
```

Open **http://localhost:5173**, create a game, and open the invite link in a **private/incognito window**
(or another browser) to play the other side. A normal second tab in the same browser shares
localStorage, so it would rejoin as the same player.

To run the production build instead (one process on port 3000):

```bash
npm run build && npm start      # http://localhost:3000
```

| Script              | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `npm run dev`       | API server (tsx watch, :3000) + Vite dev server (:5173) with HMR  |
| `npm run build`     | Builds the client to `dist/public` and bundles the server to `dist/server.js` |
| `npm start`         | Runs the production bundle; serves the client and the WebSocket API |
| `npm test`          | Engine unit tests + an end-to-end Socket.IO test (Vitest)         |
| `npm run typecheck` | Type-checks server and client                                     |

Environment: `PORT` (default 3000). `PUBLIC_DIR` overrides where the built client is served from.

## Project layout

```
shared/protocol.ts        Wire types shared by client and server (GameView, socket events, limits)
server/src/
  index.ts                Express + Socket.IO bootstrap, static hosting, /healthz
  GameService.ts          Socket handlers: rooms, seats/tokens, per-game locking, clocks, chat
  game/engine.ts          Pure game logic: chess.js + mines (moves, explosions, endings, clocks)
  game/mines.ts           Mine placement, neighbour counts, flood-fill reveal
  game/view.ts            buildView(): the ONLY way game state leaves the server (redaction)
  game/types.ts           GameState: the authoritative, JSON-serialisable record of a game
  store/GameStore.ts      Storage interface + in-memory implementation (24h idle expiry)
server/test/              Engine tests and a multi-client Socket.IO test
client/src/
  components/Board.tsx    Board rendering, tap/drag moves, flags, legal-move hints, explosion FX
  components/GamePage.tsx Game screen: status, clocks, actions, sound, reconnect handling
  components/Lobby.tsx    Create/join screens and settings
  components/Panels.tsx   Player bars (clock, captures), move list, chat
  lib/                    socket singleton, Web Audio sounds, formatting, safe localStorage
client/public/pieces/     cburnett SVG pieces
```

## Rules as implemented

**Setup.** The creator picks 0–12 mines (default 6), a time control, a mine zone and a color.

- **Middle ranks**: mines go on ranks 3–6, the squares that are empty at the start.
- **Anywhere**: mines can be on any square. A standard board's only empty squares at the start *are*
  ranks 3–6, so "anywhere empty" would have been identical to "middle". Instead, a mine under a starting
  piece lies **dormant**. That piece never stepped onto it, so it's never hurt, but the mine arms once the
  square is vacated. A later arrival on that square, including a piece **capturing** there, sets it off.

**Stepping on squares.** Only the square a piece *lands on* counts. Squares a slider passes over and
squares a knight jumps over are not stepped on. When castling, both the king's and the rook's
destinations count. En passant counts the capturing pawn's landing square.

- **Mine**: the piece that landed is destroyed (a promoting pawn blows up as the promoted piece). A
  capture made on the way still happens. The mine is used up, and its square becomes a public crater
  that is safe to stand on afterwards.
- **Safe**: the square is revealed for both players with its adjacent-mine count (1 blue, 2 green,
  3 red, ...). A `0` flood-fills its neighbours like Minesweeper. Counts include mines that already went
  off, which are visible as craters, so a revealed number never changes.

**Endings.**

- Checkmate, resignation and timeout (a draw if the opponent has only a king) end the game as usual.
- **King on a mine**: if your king steps on a mine, you lose immediately.
- **Exposed king**: if your exploding piece was shielding your own king (for example, a pinned rook moving
  along the pin onto a mine), you lose. Your opponent could simply capture the king.
- Check and mate are judged *after* explosions. A mating move whose piece blows up isn't mate, and the
  move list shows `Ra8💥` instead of `Ra8#`.
- Stalemate, insufficient material, threefold repetition and the fifty-move rule are automatic draws. An
  explosion resets the fifty-move counter, like a capture.
- Legal moves are ordinary chess moves. Legality never depends on where the mines are, because that
  would leak them.

**Flags** are private notes stored on the server and sent only to the player who placed them. They
don't block anything, unless you turn on **King guard**, which stops *your* king from moving onto
*your* flagged squares. That's a client-side safety catch, not a rule change, so it never affects
checkmate or stalemate detection.

**Clocks** start after White's first move. The server is the timekeeper: it deducts thinking time on
each move and runs a timer that flags whoever is on move when their time runs out. Clients just count
down between updates.

## How hidden information is protected

The browser never receives anything it isn't allowed to know:

1. **Mines exist only on the server.** They're placed with Node's CSPRNG (`crypto.randomInt`), so
   layouts can't be predicted from earlier games.
2. **One redaction point.** All state goes out through `buildView(state, role)` in
   `server/src/game/view.ts`. It builds each client's view field by field and never spreads the
   internal state, so a new secret field can't leak by accident. During play the view contains piece
   positions, revealed numbers and craters. It has no mine list, only the viewer's own flags, and no seat
   tokens. Each socket gets its own view, so a player's flags never reach the opponent or spectators.
3. **The full mine map is sent only when the game is over**, so everyone can see where the mines were.
4. **The server is authoritative.** Clients send intents (`move`, `flag`, `resign`, ...). The server
   checks turn and seat, validates the move with chess.js, resolves mines, runs the clock and checks
   every payload, so a modified client can't cheat or crash it.
5. **Nothing correlates with mines.** Legal-move lists are pure chess, and the error for an illegal move
   is the same wherever the mines are.

Tests enforce this. `engine.test.ts` checks that two games differing *only* in mine layout produce
byte-identical views, and `socket.test.ts` records every raw payload three clients receive over a real
Socket.IO connection and asserts that none contains the mine list or another player's token.

**Seats and reconnects.** Creating or joining a seat issues a random 128-bit token, which the browser
keeps in `localStorage` under `mc:token:<ROOM>`. On reconnect or refresh the client re-sends it and gets
its seat back. Anyone without a matching token joins as a spectator once both seats are taken.

## Deploying

The app is one Node process that serves both the static client and the WebSocket API. Games live in
memory, so **run a single instance**. Every platform below gives you HTTPS, and WebSockets work out of
the box.

### Render

Use the included `render.yaml` (New > Blueprint), or create a **Web Service** by hand:

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`

Free instances sleep when idle, which ends any games in progress.

### Railway

New Project > Deploy from GitHub repo. Railway detects Node, runs `npm run build`, starts the app
with `npm start` and sets `PORT` itself. Under Settings > Networking, click **Generate Domain**.

### Fly.io

The repo has a `Dockerfile`, so:

```bash
fly launch --internal-port 3000 --no-deploy   # accept the generated fly.toml
fly scale count 1                             # in-memory state: exactly one machine
fly deploy
```

### DigitalOcean droplet (GitHub Actions + Cloudflare)

`.github/workflows/deploy.yml` deploys every push to `main`. It runs the typecheck and tests, builds the
Docker image, streams it to the droplet over SSH (`docker save | docker load`, no registry), and restarts
the stack in `compose.yaml`. Caddy terminates HTTPS in front of the app with a Cloudflare Origin
Certificate. A deploy restarts the process, which ends any games in progress.

**1. Droplet** (Ubuntu, once, as root):

```bash
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
install -d -o deploy -g deploy /opt/minefield-chess /opt/minefield-chess/certs
echo "DOMAIN=chess.example.com" > /opt/minefield-chess/.env
```

Membership in the `docker` group is root-equivalent, so guard the deploy key like a root key.

**2. Deploy key** (on your machine):

```bash
ssh-keygen -t ed25519 -N "" -C github-deploy -f ~/.ssh/minefield_deploy
ssh root@DROPLET_IP 'cat >> /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys' < ~/.ssh/minefield_deploy.pub
```

**3. GitHub secrets** (Settings > Secrets and variables > Actions):

| Secret            | Value                                     |
| ----------------- | ----------------------------------------- |
| `SSH_HOST`        | the droplet's IP                          |
| `SSH_USER`        | `deploy`                                  |
| `SSH_PRIVATE_KEY` | contents of `~/.ssh/minefield_deploy`     |
| `SSH_KNOWN_HOSTS` | output of `ssh-keyscan DROPLET_IP`        |

**4. Cloudflare:**

1. **DNS > Records > Add record**: type `A`, name `chess` (or `@` for the bare domain), IPv4 = the
   droplet's IP, proxy status **Proxied** (orange cloud).
2. **SSL/TLS > Overview**: set the encryption mode to **Full (strict)**.
3. **SSL/TLS > Origin Server > Create Certificate** (the defaults cover `example.com` and `*.example.com`
   for 15 years). On the droplet, save the certificate as `/opt/minefield-chess/certs/origin.pem` and the
   private key as `/opt/minefield-chess/certs/origin.key` (`chmod 600`). Cloudflare shows the key only once.
4. **Network > WebSockets** is on by default. Leave it on.

**5. Deploy**: push to `main`, or run the workflow from the Actions tab.

Optional hardening: allow ports 80 and 443 only from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/)
with a DigitalOcean Cloud Firewall. `ufw` can't do this, because Docker-published ports bypass it.

### Any Docker host

```bash
docker build -t minefield-chess .
docker run -p 3000:3000 minefield-chess
```

## Adding a database later

`GameState` is plain JSON, and all persistence goes through the async `GameStore` interface
(`get`, `save`, `delete`, `has`):

- **Redis**: `save` = `SET game:<code> <json> EX 86400`, `get` = `GET` + `JSON.parse`. Swap
  `new MemoryGameStore()` in `server/src/index.ts` for your implementation.
- **Postgres**: one `games(code text primary key, state jsonb, updated_at timestamptz)` table works.

`GameService` already serialises operations per game with an in-process lock, so an async store can't
interleave two moves for the same game. To run **several instances**, also add:

- the Socket.IO Redis adapter (`@socket.io/redis-adapter`) and sticky sessions at the load balancer
- a distributed lock (or optimistic versioning on `updatedAt`) in place of the in-process lock
- re-arming clock timers on startup for active timed games (or a periodic sweep that calls
  `checkTimeout`)

## Credits

Chess pieces: the "cburnett" set by [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett),
licensed GPLv2+, taken unmodified from [lichess](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett).
See `client/public/pieces/CREDITS.md`. If you need different licensing, swap in another SVG set with
the same file names (`wK.svg`, `bQ.svg`, ...).
