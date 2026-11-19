import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import { createApp } from '../src/app.js';
import { createWebSocketServer } from '../src/websocket.js';
import { redisService } from '../src/services/redis.service.js';
import { channelService } from '../src/services/channel.service.js';
import { loggerService } from '../src/services/logger.service.js';
import type { Express } from 'express';

describe('Microservice REST API Endpoints', () => {
  let app: Express;
  let httpServer: http.Server;

  beforeAll(async () => {
    httpServer = http.createServer();
    const io = createWebSocketServer(httpServer);
    app = createApp(io);
    httpServer.on('request', app);

    await redisService.connect();
    await redisService.clearAll();
    await channelService.initializeDefaultChannels();
  });

  afterAll(async () => {
    await loggerService.close();
    await redisService.disconnect();
  });

  it('GET /health - should return healthy status, redis status and system metrics', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.redis.status).toBe('connected');
    expect(res.body.fileStoreLogger.status).toBe('active');
    expect(res.body.system.memoryUsageMB).toBeDefined();
    expect(res.body.websocket.activeConnections).toBeDefined();
  });

  it('GET /api/channels - should return list of active channels', async () => {
    const res = await request(app).get('/api/channels');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.channels)).toBe(true);
    expect(res.body.data.channels.length).toBeGreaterThanOrEqual(4);
    const names = res.body.data.channels.map((c: any) => c.name);
    expect(names).toContain('general');
    expect(names).toContain('tech');
  });

  it('GET /api/users/active - should return active users cached in Redis', async () => {
    // Cache a mock user
    await redisService.cacheUserSession({
      userId: 'test_api_user',
      username: 'ApiTester',
      socketId: 'sock_api',
      connectedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      channels: ['general'],
    });

    const res = await request(app).get('/api/users/active');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBeGreaterThanOrEqual(1);
    const user = res.body.data.users.find((u: any) => u.userId === 'test_api_user');
    expect(user).toBeDefined();
    expect(user.username).toBe('ApiTester');
  });

  it('GET /api/channels/:name/users - should return users in specified channel', async () => {
    await channelService.joinChannel('tech', 'test_api_user');

    const res = await request(app).get('/api/channels/tech/users');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channel).toBe('tech');
    expect(res.body.data.count).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/logs/transactions - should query persistent audit logs', async () => {
    loggerService.log({
      transactionId: 'tx-api-test',
      event: 'MESSAGE_SENT',
      senderId: 'test_api_user',
      senderUsername: 'ApiTester',
      target: 'tech',
      payloadSize: 50,
      status: 'SUCCESS',
    });
    await loggerService.flush();

    const res = await request(app).get('/api/logs/transactions?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.transactions)).toBe(true);
    const found = res.body.data.transactions.find((t: any) => t.transactionId === 'tx-api-test');
    expect(found).toBeDefined();
    expect(found.timestamp).toBeDefined();
  });

  it('GET /api/logs/stats - should return logger operational metrics', async () => {
    const res = await request(app).get('/api/logs/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalLogged).toBeGreaterThan(0);
    expect(res.body.data.currentLogFile).toBeDefined();
  });
});
