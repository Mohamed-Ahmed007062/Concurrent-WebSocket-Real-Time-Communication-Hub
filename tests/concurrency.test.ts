import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createWebSocketServer } from '../src/websocket.js';
import { redisService } from '../src/services/redis.service.js';
import { channelService } from '../src/services/channel.service.js';
import { loggerService } from '../src/services/logger.service.js';

describe('High Concurrency WebSocket Pipeline Stress Test', () => {
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

  it('should handle multiple concurrent clients sending simultaneous messages without dropped packets', async () => {
    const CLIENT_COUNT = 10;
    const MESSAGES_PER_CLIENT = 5;
    const TOTAL_EXPECTED = CLIENT_COUNT * MESSAGES_PER_CLIENT;

    const clients: ClientSocket[] = [];
    const clientPromises = [];

    for (let i = 0; i < CLIENT_COUNT; i++) {
      clientPromises.push(
        new Promise<ClientSocket>((resolve, reject) => {
          const s = Client(`http://localhost:${serverPort}`, {
            auth: { username: `Concurrent_User_${i}`, userId: `concurrent_user_${i}` },
            transports: ['websocket'],
          });
          s.on('connect', () => resolve(s));
          s.on('connect_error', (err) => reject(err));
        })
      );
    }

    const connectedClients = await Promise.all(clientPromises);
    clients.push(...connectedClients);

    // Verify all 10 are active in Redis
    const cachedUsers = await redisService.getAllActiveUsers();
    expect(cachedUsers.length).toBeGreaterThanOrEqual(CLIENT_COUNT);

    let totalBroadcastsReceived = 0;
    connectedClients.forEach((client) => {
      client.on('message:broadcast', () => {
        totalBroadcastsReceived++;
      });
    });

    // Send messages concurrently across all clients
    const sendPromises: Promise<any>[] = [];
    for (let c = 0; c < CLIENT_COUNT; c++) {
      for (let m = 0; m < MESSAGES_PER_CLIENT; m++) {
        sendPromises.push(
          new Promise<void>((resolve) => {
            connectedClients[c].emit(
              'message:channel',
              { channel: 'general', content: `Message from client ${c} index ${m}` },
              (res) => {
                expect(res.success).toBe(true);
                expect(res.data?.transactionId).toBeDefined();
                resolve();
              }
            );
          })
        );
      }
    }

    await Promise.all(sendPromises);

    // Wait short time for network fanout
    await new Promise((r) => setTimeout(r, 200));

    // In a channel with N clients, each broadcast message is delivered to all N clients
    expect(totalBroadcastsReceived).toBe(TOTAL_EXPECTED * CLIENT_COUNT);

    // Verify persistent logger records
    await loggerService.flush();
    const stats = loggerService.getStats();
    expect(stats.totalLogged).toBeGreaterThanOrEqual(TOTAL_EXPECTED);

    // Cleanup clients
    clients.forEach((c) => c.disconnect());
  });
});
