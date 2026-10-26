import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/protocol';

/** One connection for the whole app; Socket.IO reconnects on its own. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  transports: ['websocket', 'polling'],
});
