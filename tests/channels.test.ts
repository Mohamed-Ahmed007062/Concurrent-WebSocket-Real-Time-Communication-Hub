import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createWebSocketServer } from '../src/websocket.js';
import { redisService } from '../src/services/redis.service.js';
import { channelService } from '../src/services/channel.service.js';
import { loggerService } from '../src/services/logger.service.js';
import { ChatMessage } from '../src/types/index.js';

describe('Channel Isolation & Dynamic Multi-Channel Tests', () => {
  let httpServer: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    httpServer = http.createServer();
    const io = createWebSocketServer(httpServer);
    const app = createApp(io);
    httpServer.on('request', app);

    await redisService.connect();
    await redisService.clearAll();
    await channelService.initializeDefaultChannels();

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await loggerService.close();
    await redisService.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  const createClient = (username: string, userId?: string): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const socket = Client(`http://localhost:${serverPort}`, {
        auth: { username, userId },
        transports: ['websocket'],
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  };

  it('should isolate messages strictly to their respective channels', async () => {
    const clientTech = await createClient('TechUser', 'user_tech_dev');
    const clientRandom = await createClient('RandomUser', 'user_random_dev');

    // Join separate rooms
    await new Promise<void>((resolve) => {
      clientTech.emit('channel:join', { channel: 'tech' }, () => resolve());
    });
    await new Promise<void>((resolve) => {
      clientRandom.emit('channel:join', { channel: 'random' }, () => resolve());
    });

    let randomSawTechMessage = false;
    clientRandom.on('message:broadcast', (msg: ChatMessage) => {
      if (msg.channel === 'tech') {
        randomSawTechMessage = true;
      }
    });

    // Send to tech
    await new Promise<void>((resolve) => {
      clientTech.emit(
        'message:channel',
        { channel: 'tech', content: 'Tech message strictly for tech channel' },
        () => resolve()
      );
    });

    // Brief delay to allow event propagation
    await new Promise((r) => setTimeout(r, 100));

    expect(randomSawTechMessage).toBe(false);

    clientTech.disconnect();
    clientRandom.disconnect();
  });

  it('should reject invalid channel names or empty messages with structured validation errors', async () => {
    const client = await createClient('ValidatorTest', 'user_validator');

    try {
      // Test invalid channel name with special characters
      const joinErrorPromise = new Promise<{ message: string; details: unknown }>((resolve) => {
        client.once('error:validation', (err) => resolve(err));
      });

      client.emit('channel:join', { channel: 'invalid/channel/name!' });
      const joinErr = await joinErrorPromise;
      expect(joinErr.message).toBe('Invalid channel join payload');

      // Test empty message content
      const msgErrorPromise = new Promise<{ message: string }>((resolve) => {
        client.once('error:validation', (err) => resolve(err));
      });

      client.emit('message:channel', { channel: 'general', content: '   ' });
      const msgErr = await msgErrorPromise;
      expect(msgErr.message).toContain('cannot be empty');
    } finally {
      client.disconnect();
    }
  });

  it('should support dynamic channel creation and listing', async () => {
    const client = await createClient('DynamicChUser', 'user_dyn_ch');

    // Join a newly invented channel
    await new Promise<void>((resolve) => {
      client.emit('channel:join', { channel: 'devops-special' }, (res) => {
        expect(res.success).toBe(true);
        expect(res.data?.channel).toBe('devops-special');
        resolve();
      });
    });

    // Request channel list
    const channelList = await new Promise<any[]>((resolve) => {
      client.emit('channel:list', (res) => {
        resolve(res.data?.channels || []);
      });
    });

    const devopsCh = channelList.find((c) => c.name === 'devops-special');
    expect(devopsCh).toBeDefined();
    expect(devopsCh.userCount).toBe(1);

    // Leave channel
    await new Promise<void>((resolve) => {
      client.emit('channel:leave', { channel: 'devops-special' }, (res) => {
        expect(res.success).toBe(true);
        resolve();
      });
    });

    client.disconnect();
  });
});
