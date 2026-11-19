import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { redisService } from '../services/redis.service.js';
import { loggerService } from '../services/logger.service.js';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/events.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerPresenceHandlers(io: AppServer, socket: AppSocket) {
  // Typing Start Indicator
  socket.on('typing:start', async (data) => {
    if (data?.channel) {
      const roomKey = `channel:${data.channel.toLowerCase()}`;
      socket.to(roomKey).emit('typing:indicator', {
        userId: socket.data.userId,
        username: socket.data.username,
        channel: data.channel.toLowerCase(),
        isTyping: true,
      });
    } else if (data?.recipientId) {
      const recipient = await redisService.getUserSession(data.recipientId);
      if (recipient) {
        io.to(recipient.socketId).emit('typing:indicator', {
          userId: socket.data.userId,
          username: socket.data.username,
          recipientId: data.recipientId,
          isTyping: true,
        });
      }
    }
  });

  // Typing Stop Indicator
  socket.on('typing:stop', async (data) => {
    if (data?.channel) {
      const roomKey = `channel:${data.channel.toLowerCase()}`;
      socket.to(roomKey).emit('typing:indicator', {
        userId: socket.data.userId,
        username: socket.data.username,
        channel: data.channel.toLowerCase(),
        isTyping: false,
      });
    } else if (data?.recipientId) {
      const recipient = await redisService.getUserSession(data.recipientId);
      if (recipient) {
        io.to(recipient.socketId).emit('typing:indicator', {
          userId: socket.data.userId,
          username: socket.data.username,
          recipientId: data.recipientId,
          isTyping: false,
        });
      }
    }
  });

  // Full-Duplex Heartbeat Pipeline
  socket.on('heartbeat:ping', async (data, callback) => {
    const serverTimestamp = Date.now();
    const clientTimestamp = data?.clientTimestamp || serverTimestamp;
    const latencyMs = Math.max(0, serverTimestamp - clientTimestamp);

    // Update user active timestamp in Redis
    await redisService.updateUserHeartbeat(socket.data.userId);

    // Acknowledge back immediately with latency calculation
    callback({
      serverTimestamp,
      latencyMs,
    });
  });

  // Retrieve All Cached Active Users from Redis
  socket.on('users:active', async (callback) => {
    try {
      const activeUsers = await redisService.getAllActiveUsers();
      callback({
        success: true,
        data: { users: activeUsers },
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      callback({
        success: false,
        error: `Failed to fetch active users: ${errMsg}`,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
