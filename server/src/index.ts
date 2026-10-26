import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { GameService, type IO } from './GameService';
import { MemoryGameStore } from './store/GameStore';

const PORT = Number(process.env.PORT ?? 3000);
// The production bundle lives at dist/server.js with the built client beside it in dist/public.
const PUBLIC_DIR =
  process.env.PUBLIC_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const app = express();
const httpServer = createServer(app);
const io: IO = new Server(httpServer, { maxHttpBufferSize: 16_000 });

new GameService(io, new MemoryGameStore());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));
  // Single-page app: every other GET (e.g. /g/ABC123) gets index.html.
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

httpServer.listen(PORT, () => {
  console.log(`Minefield Chess server listening on http://localhost:${PORT}`);
  if (!existsSync(PUBLIC_DIR)) console.log('Dev mode: open the Vite client at http://localhost:5173');
});
