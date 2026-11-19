import { Router } from 'express';
import { redisService } from '../services/redis.service.js';
import { loggerService } from '../services/logger.service.js';
import type { Server as SocketIOServer } from 'socket.io';

export function createHealthRouter(getIo?: SocketIOServer | (() => SocketIOServer | undefined)): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const memory = process.memoryUsage();
    const redisHealth = await redisService.isHealthy();
    const loggerStats = loggerService.getStats();

    const io = typeof getIo === 'function' ? getIo() : getIo;
    const activeSockets = io?.engine?.clientsCount ?? 0;

    const isHealthy = redisHealth.connected;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      system: {
        nodeVersion: process.version,
        memoryUsageMB: {
          rss: Math.round(memory.rss / (1024 * 1024)),
          heapUsed: Math.round(memory.heapUsed / (1024 * 1024)),
          heapTotal: Math.round(memory.heapTotal / (1024 * 1024)),
        },
      },
      websocket: {
        activeConnections: activeSockets,
      },
      redis: {
        status: redisHealth.connected ? 'connected' : 'disconnected',
        mode: redisHealth.mode,
        cachedActiveUsers: redisHealth.activeUsers,
        totalChannels: redisHealth.channelCount,
      },
      fileStoreLogger: {
        status: 'active',
        totalTransactionsLogged: loggerStats.totalLogged,
        pendingBufferCount: loggerStats.pendingBufferCount,
        currentFile: loggerStats.currentLogFile,
      },
    });
  });

  return router;
}
