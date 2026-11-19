import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { redisService } from '../services/redis.service.js';
import { loggerService } from '../services/logger.service.js';
import { channelService } from '../services/channel.service.js';
import { socketRateLimiter } from '../middleware/rateLimiter.js';
import { authHandshakeSchema } from '../middleware/validator.js';
import { registerChannelHandlers } from './channel.handler.js';
import { registerMessageHandlers } from './message.handler.js';
import { registerPresenceHandlers } from './presence.handler.js';
import { UserSession } from '../types/index.js';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/events.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Socket.io handshake authentication & validation middleware
 */
export async function authenticateSocket(socket: AppSocket, next: (err?: Error) => void) {
  try {
    const rawAuth = socket.handshake.auth || {};
    const rawQuery = socket.handshake.query || {};

    const username = (rawAuth.username || rawQuery.username || '').toString().trim();
    const customUserId = (rawAuth.userId || rawQuery.userId || '').toString().trim();

    const validation = authHandshakeSchema.safeParse({
      username: username || `Guest_${socket.id.slice(0, 5)}`,
      userId: customUserId || undefined,
    });

    if (!validation.success) {
      return next(new Error(`Authentication failed: ${validation.error.errors[0]?.message}`));
    }

    const finalUserId = validation.data.userId || `user_${randomUUID().slice(0, 8)}`;
    const finalUsername = validation.data.username;

    // Attach data to socket
    socket.data.userId = finalUserId;
    socket.data.username = finalUsername;
    socket.data.connectedAt = new Date().toISOString();
    socket.data.channels = new Set<string>();

    next();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    next(new Error(`Handshake error: ${errMsg}`));
  }
}

/**
 * Handle new authenticated socket connection
 */
export async function handleConnection(io: AppServer, socket: AppSocket) {
  const { userId, username, connectedAt } = socket.data;
  const clientIp = socket.handshake.address || socket.conn.remoteAddress || '127.0.0.1';
  const userAgent = socket.handshake.headers['user-agent'] || 'unknown';

  // 1. Cache User Session in Redis
  const session: UserSession = {
    userId,
    username,
    socketId: socket.id,
    connectedAt,
    lastActiveAt: connectedAt,
    channels: ['general'],
    clientIp,
    userAgent,
  };

  await redisService.cacheUserSession(session);

  // 2. Automatically join default '#general' channel
  const defaultChannel = 'general';
  await socket.join(`channel:${defaultChannel}`);
  socket.data.channels.add(defaultChannel);
  await channelService.joinChannel(defaultChannel, userId);

  // 3. Broadcast Online Presence Update to all connected clients
  io.emit('user:presence_update', {
    userId,
    username,
    status: 'online',
    timestamp: connectedAt,
  });

  // 4. Log USER_CONNECT Transaction to persistent file store
  loggerService.log({
    transactionId: randomUUID(),
    event: 'USER_CONNECT',
    senderId: userId,
    senderUsername: username,
    target: defaultChannel,
    payloadSize: JSON.stringify(session).length,
    status: 'SUCCESS',
    details: {
      socketId: socket.id,
      clientIp,
    },
  });

  // 5. Register Sub-Handlers
  registerChannelHandlers(io, socket);
  registerMessageHandlers(io, socket);
  registerPresenceHandlers(io, socket);

  // 6. Handle Disconnection & Cleanup
  socket.on('disconnect', async (reason) => {
    const disconnectedAt = new Date().toISOString();

    // Clean up per-socket rate limiter memory
    socketRateLimiter.cleanup(socket.id);

    // Remove user session and channel presence from Redis
    await redisService.removeUserSession(userId, socket.id);

    // Broadcast Offline Presence Update to all remaining clients
    io.emit('user:presence_update', {
      userId,
      username,
      status: 'offline',
      timestamp: disconnectedAt,
    });

    // Log USER_DISCONNECT Transaction to persistent file store
    loggerService.log({
      transactionId: randomUUID(),
      event: 'USER_DISCONNECT',
      senderId: userId,
      senderUsername: username,
      payloadSize: 0,
      status: 'SUCCESS',
      details: {
        reason,
        sessionDurationMs: Date.now() - new Date(connectedAt).getTime(),
      },
    });
  });
}
