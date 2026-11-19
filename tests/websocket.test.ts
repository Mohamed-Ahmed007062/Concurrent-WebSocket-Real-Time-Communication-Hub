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

describe('Concurrent WebSocket Real-Time Communication Hub', () => {
  let httpServer: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    // Setup server on dynamic port
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

  const createTestClient = (username: string, userId?: string): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const socket = Client(`http://localhost:${serverPort}`, {
        auth: { username, userId },
        transports: ['websocket'],
      });

      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  };

  it('should connect multiple clients concurrently and cache their sessions in Redis', async () => {
    const client1 = await createTestClient('Alice', 'user_alice');
    const client2 = await createTestClient('Bob', 'user_bob');
    const client3 = await createTestClient('Charlie', 'user_charlie');

    // Verify Redis has all 3 active users cached
    const activeUsers = await redisService.getAllActiveUsers();
    expect(activeUsers.length).toBeGreaterThanOrEqual(3);

    const aliceSession = await redisService.getUserSession('user_alice');
    expect(aliceSession).not.toBeNull();
    expect(aliceSession?.username).toBe('Alice');
    expect(aliceSession?.channels).toContain('general');

    const bobSession = await redisService.getUserSession('user_bob');
    expect(bobSession?.username).toBe('Bob');

    client1.disconnect();
    client2.disconnect();
    client3.disconnect();
  });

  it('should broadcast channel messages to all channel subscribers', async () => {
    const client1 = await createTestClient('Alice', 'user_alice_broadcast');
    const client2 = await createTestClient('Bob', 'user_bob_broadcast');

    // Both are in 'general' by default. Let them join 'tech' channel
    await new Promise<void>((resolve) => {
      client1.emit('channel:join', { channel: 'tech' }, () => resolve());
    });

    await new Promise<void>((resolve) => {
      client2.emit('channel:join', { channel: 'tech' }, () => resolve());
    });

    // Listen on client2 for broadcast
    const receivedMessagePromise = new Promise<ChatMessage>((resolve) => {
      client2.on('message:broadcast', (msg: ChatMessage) => {
        if (msg.channel === 'tech') {
          resolve(msg);
        }
      });
    });

    // Client1 sends message to 'tech'
    await new Promise<void>((resolve) => {
      client1.emit(
        'message:channel',
        { channel: 'tech', content: 'Hello tech team!' },
        (res) => {
          expect(res.success).toBe(true);
          expect(res.data?.transactionId).toBeDefined();
          resolve();
        }
      );
    });

    const received = await receivedMessagePromise;
    expect(received.content).toBe('Hello tech team!');
    expect(received.channel).toBe('tech');
    expect(received.senderUsername).toBe('Alice');
    expect(received.timestamp).toBeDefined();

    client1.disconnect();
    client2.disconnect();
  });

  it('should route 1-to-1 direct messages exclusively between sender and recipient', async () => {
    const clientSender = await createTestClient('SenderUser', 'user_sender_dm');
    const clientReceiver = await createTestClient('ReceiverUser', 'user_receiver_dm');
    const clientThird = await createTestClient('ThirdParty', 'user_third');

    let thirdPartySawMessage = false;
    clientThird.on('message:direct', () => {
      thirdPartySawMessage = true;
    });

    const receiverPromise = new Promise<ChatMessage>((resolve) => {
      clientReceiver.on('message:direct', (msg) => resolve(msg));
    });

    // Send direct message
    await new Promise<void>((resolve) => {
      clientSender.emit(
        'message:direct',
        { recipientId: 'user_receiver_dm', content: 'Secret private message' },
        (res) => {
          expect(res.success).toBe(true);
          resolve();
        }
      );
    });

    const delivered = await receiverPromise;
    expect(delivered.content).toBe('Secret private message');
    expect(delivered.recipientId).toBe('user_receiver_dm');
    expect(delivered.senderId).toBe('user_sender_dm');
    expect(thirdPartySawMessage).toBe(false);

    clientSender.disconnect();
    clientReceiver.disconnect();
    clientThird.disconnect();
  });

  it('should support full-duplex heartbeat ping-pong and calculate latency', async () => {
    const client = await createTestClient('PingTester', 'user_ping');

    const clientNow = Date.now() - 5;
    const response = await new Promise<{ serverTimestamp: number; latencyMs: number }>((resolve) => {
      client.emit('heartbeat:ping', { clientTimestamp: clientNow }, (res) => resolve(res));
    });

    expect(response.serverTimestamp).toBeGreaterThan(0);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);

    client.disconnect();
  });

  it('should enforce per-socket rate limiting on message spam', async () => {
    const client = await createTestClient('SpamTester', 'user_spammer');

    let rateLimitErrorReceived = false;
    client.on('error:rate_limit', () => {
      rateLimitErrorReceived = true;
    });

    // Send rapid burst of messages exceeding limit (limit is 15 in config)
    for (let i = 0; i < 20; i++) {
      client.emit('message:channel', { channel: 'general', content: `Spam #${i}` });
    }

    // Wait short time for socket events
    await new Promise((r) => setTimeout(r, 100));

    expect(rateLimitErrorReceived).toBe(true);

    client.disconnect();
  });

  it('should clean up Redis presence and notify peers on socket disconnect', async () => {
    const client1 = await createTestClient('Observer', 'user_observer');
    const client2 = await createTestClient('Leaver', 'user_leaver');

    const offlineEventPromise = new Promise<{ userId: string; status: string }>((resolve) => {
      client1.on('user:presence_update', (data) => {
        if (data.userId === 'user_leaver' && data.status === 'offline') {
          resolve(data);
        }
      });
    });

    client2.disconnect();

    const offlineEvent = await offlineEventPromise;
    expect(offlineEvent.userId).toBe('user_leaver');
    expect(offlineEvent.status).toBe('offline');

    // Wait brief moment for Redis async cleanup
    await new Promise((r) => setTimeout(r, 100));

    const leaverSession = await redisService.getUserSession('user_leaver');
    expect(leaverSession).toBeNull();

    client1.disconnect();
  });
});
