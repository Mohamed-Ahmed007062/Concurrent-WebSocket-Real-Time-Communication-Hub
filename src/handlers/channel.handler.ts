import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { channelService } from '../services/channel.service.js';
import { loggerService } from '../services/logger.service.js';
import { joinChannelSchema, leaveChannelSchema } from '../middleware/validator.js';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/events.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerChannelHandlers(io: AppServer, socket: AppSocket) {
  // Join Channel
  socket.on('channel:join', async (data, callback) => {
    try {
      const validation = joinChannelSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error:validation', {
          message: 'Invalid channel join payload',
          details: validation.error.format(),
        });
        if (callback) {
          callback({
            success: false,
            error: validation.error.errors[0]?.message || 'Invalid channel name',
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      const channel = validation.data.channel.toLowerCase();
      const roomKey = `channel:${channel}`;

      // Join Socket.io room
      await socket.join(roomKey);
      socket.data.channels.add(channel);

      // Cache membership in Redis
      const userCount = await channelService.joinChannel(channel, socket.data.userId);

      const timestamp = new Date().toISOString();

      // Broadcast join event to all channel occupants
      socket.to(roomKey).emit('user:joined_channel', {
        channel,
        user: {
          userId: socket.data.userId,
          username: socket.data.username,
        },
        timestamp,
      });

      // Log transaction to persistent file store
      loggerService.log({
        transactionId: randomUUID(),
        event: 'CHANNEL_JOIN',
        senderId: socket.data.userId,
        senderUsername: socket.data.username,
        target: channel,
        payloadSize: JSON.stringify(data).length,
        status: 'SUCCESS',
        details: { userCount },
      });

      if (callback) {
        callback({
          success: true,
          message: `Successfully joined #${channel}`,
          data: { channel, userCount },
          timestamp,
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (callback) {
        callback({
          success: false,
          error: `Failed to join channel: ${errMsg}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  // Leave Channel
  socket.on('channel:leave', async (data, callback) => {
    try {
      const validation = leaveChannelSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error:validation', {
          message: 'Invalid channel leave payload',
          details: validation.error.format(),
        });
        if (callback) {
          callback({
            success: false,
            error: validation.error.errors[0]?.message || 'Invalid channel name',
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      const channel = validation.data.channel.toLowerCase();
      const roomKey = `channel:${channel}`;

      await socket.leave(roomKey);
      socket.data.channels.delete(channel);

      // Remove from Redis cache
      await channelService.leaveChannel(channel, socket.data.userId);

      const timestamp = new Date().toISOString();

      // Notify others in the channel
      socket.to(roomKey).emit('user:left_channel', {
        channel,
        user: {
          userId: socket.data.userId,
          username: socket.data.username,
        },
        timestamp,
      });

      // Log transaction to persistent file store
      loggerService.log({
        transactionId: randomUUID(),
        event: 'CHANNEL_LEAVE',
        senderId: socket.data.userId,
        senderUsername: socket.data.username,
        target: channel,
        payloadSize: JSON.stringify(data).length,
        status: 'SUCCESS',
      });

      if (callback) {
        callback({
          success: true,
          message: `Successfully left #${channel}`,
          data: { channel },
          timestamp,
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (callback) {
        callback({
          success: false,
          error: `Failed to leave channel: ${errMsg}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  // List Channels
  socket.on('channel:list', async (callback) => {
    try {
      const channels = await channelService.listChannels();
      callback({
        success: true,
        data: { channels },
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      callback({
        success: false,
        error: `Failed to list channels: ${errMsg}`,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
