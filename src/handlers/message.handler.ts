import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { redisService } from '../services/redis.service.js';
import { loggerService } from '../services/logger.service.js';
import { socketRateLimiter } from '../middleware/rateLimiter.js';
import { channelMessageSchema, directMessageSchema } from '../middleware/validator.js';
import { ChatMessage } from '../types/index.js';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/events.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerMessageHandlers(io: AppServer, socket: AppSocket) {
  // Broadcast Channel Message
  socket.on('message:channel', async (data, callback) => {
    const startTime = Date.now();
    const transactionId = randomUUID();

    // 1. Rate Limiting Check
    const rateCheck = socketRateLimiter.checkLimit(socket.id);
    if (!rateCheck.allowed) {
      socket.emit('error:rate_limit', {
        message: 'Message rate limit exceeded. Please slow down.',
        retryAfterMs: rateCheck.retryAfterMs,
      });

      loggerService.log({
        transactionId,
        event: 'MESSAGE_SENT',
        senderId: socket.data.userId,
        senderUsername: socket.data.username,
        target: data?.channel,
        payloadSize: JSON.stringify(data || {}).length,
        status: 'RATE_LIMITED',
        latencyMs: Date.now() - startTime,
        details: { retryAfterMs: rateCheck.retryAfterMs },
      });

      if (callback) {
        callback({
          success: false,
          error: 'Rate limit exceeded. Please wait before sending another message.',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // 2. Schema Validation
    const validation = channelMessageSchema.safeParse(data);
    if (!validation.success) {
      const errorMsg = validation.error.errors[0]?.message || 'Invalid message payload';
      socket.emit('error:validation', {
        message: errorMsg,
        details: validation.error.format(),
      });

      loggerService.log({
        transactionId,
        event: 'MESSAGE_SENT',
        senderId: socket.data.userId,
        senderUsername: socket.data.username,
        target: data?.channel,
        payloadSize: JSON.stringify(data || {}).length,
        status: 'ERROR',
        latencyMs: Date.now() - startTime,
        details: { validationError: errorMsg },
      });

      if (callback) {
        callback({
          success: false,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    const { channel, content } = validation.data;
    const cleanChannel = channel.toLowerCase();
    const roomKey = `channel:${cleanChannel}`;
    const timestamp = new Date().toISOString();

    const message: ChatMessage = {
      id: randomUUID(),
      transactionId,
      senderId: socket.data.userId,
      senderUsername: socket.data.username,
      channel: cleanChannel,
      content,
      timestamp,
      type: 'channel',
    };

    // 3. Live Full-Duplex Delivery: Broadcast to channel room
    io.to(roomKey).emit('message:broadcast', message);

    // 4. Update Sender Last Active Heartbeat in Redis
    await redisService.updateUserHeartbeat(socket.data.userId, timestamp);

    const latencyMs = Date.now() - startTime;

    // 5. Persistent File Store Audit Logging
    loggerService.log({
      transactionId,
      event: 'MESSAGE_SENT',
      senderId: socket.data.userId,
      senderUsername: socket.data.username,
      target: cleanChannel,
      payloadSize: Buffer.byteLength(content, 'utf8'),
      status: 'SUCCESS',
      latencyMs,
      details: {
        messageId: message.id,
      },
    });

    // 6. Acknowledge back to sender with transaction receipt
    if (callback) {
      callback({
        success: true,
        message: 'Message delivered successfully',
        data: {
          messageId: message.id,
          transactionId,
          timestamp,
        },
        timestamp,
      });
    }
  });

  // Direct 1-on-1 Message Pipeline
  socket.on('message:direct', async (data, callback) => {
    const startTime = Date.now();
    const transactionId = randomUUID();

    // 1. Rate Limiting Check
    const rateCheck = socketRateLimiter.checkLimit(socket.id);
    if (!rateCheck.allowed) {
      socket.emit('error:rate_limit', {
        message: 'Direct message rate limit exceeded. Please slow down.',
        retryAfterMs: rateCheck.retryAfterMs,
      });

      loggerService.log({
        transactionId,
        event: 'DIRECT_MESSAGE_SENT',
        senderId: socket.data.userId,
        senderUsername: socket.data.username,
        target: data?.recipientId,
        payloadSize: JSON.stringify(data || {}).length,
        status: 'RATE_LIMITED',
        latencyMs: Date.now() - startTime,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Rate limit exceeded.',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // 2. Schema Validation
    const validation = directMessageSchema.safeParse(data);
    if (!validation.success) {
      const errorMsg = validation.error.errors[0]?.message || 'Invalid direct message payload';
      socket.emit('error:validation', {
        message: errorMsg,
        details: validation.error.format(),
      });

      if (callback) {
        callback({
          success: false,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    const { recipientId, content } = validation.data;

    // 3. Check active recipient in Redis memory database
    const recipientSession = await redisService.getUserSession(recipientId);
    if (!recipientSession) {
      loggerService.log({
        transactionId,
        event: 'DIRECT_MESSAGE_SENT',
        senderId: socket.data.userId,
        senderUsername: socket.data.username,
        target: recipientId,
        payloadSize: Buffer.byteLength(content, 'utf8'),
        status: 'ERROR',
        latencyMs: Date.now() - startTime,
        details: { reason: 'Recipient offline or not found' },
      });

      if (callback) {
        callback({
          success: false,
          error: 'Recipient user is currently offline or does not exist.',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    const timestamp = new Date().toISOString();
    const message: ChatMessage = {
      id: randomUUID(),
      transactionId,
      senderId: socket.data.userId,
      senderUsername: socket.data.username,
      recipientId,
      content,
      timestamp,
      type: 'direct',
    };

    // 4. Live Full-Duplex Delivery: Send to recipient socket and echo to sender socket
    io.to(recipientSession.socketId).emit('message:direct', message);
    socket.emit('message:direct', message);

    await redisService.updateUserHeartbeat(socket.data.userId, timestamp);
    const latencyMs = Date.now() - startTime;

    // 5. Persistent File Store Audit Logging
    loggerService.log({
      transactionId,
      event: 'DIRECT_MESSAGE_SENT',
      senderId: socket.data.userId,
      senderUsername: socket.data.username,
      target: recipientId,
      payloadSize: Buffer.byteLength(content, 'utf8'),
      status: 'SUCCESS',
      latencyMs,
      details: {
        recipientUsername: recipientSession.username,
        messageId: message.id,
      },
    });

    // 6. Acknowledge back to sender
    if (callback) {
      callback({
        success: true,
        message: 'Direct message delivered successfully',
        data: {
          messageId: message.id,
          transactionId,
          timestamp,
        },
        timestamp,
      });
    }
  });
}
