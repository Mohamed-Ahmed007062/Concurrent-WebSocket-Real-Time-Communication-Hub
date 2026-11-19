import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env.js';
import { authenticateSocket, handleConnection } from './handlers/connection.handler.js';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './types/events.js';

export function createWebSocketServer(httpServer: HttpServer): SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
> {
  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: env.PING_INTERVAL_MS,
    pingTimeout: env.PING_TIMEOUT_MS,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6, // 1 MB max buffer for high volume
  });

  // Handshake authentication & validation middleware
  io.use(authenticateSocket);

  // Connection lifecycle handler
  io.on('connection', (socket) => {
    handleConnection(io, socket);
  });

  return io;
}
