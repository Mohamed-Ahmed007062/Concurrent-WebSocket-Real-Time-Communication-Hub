import { Router } from 'express';
import { redisService } from '../services/redis.service.js';
import { channelService } from '../services/channel.service.js';
import { loggerService } from '../services/logger.service.js';
import { TransactionEvent } from '../types/index.js';

export function createApiRouter(): Router {
  const router = Router();

  // 1. List all channels
  router.get('/channels', async (_req, res) => {
    try {
      const channels = await channelService.listChannels();
      res.json({
        success: true,
        data: { channels },
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // 2. Get members of a specific channel
  router.get('/channels/:name/users', async (req, res) => {
    try {
      const channelName = req.params.name.toLowerCase();
      const userIds = await channelService.getChannelMembers(channelName);

      const users = [];
      for (const id of userIds) {
        const user = await redisService.getUserSession(id);
        if (user) users.push(user);
      }

      res.json({
        success: true,
        data: {
          channel: channelName,
          count: users.length,
          users,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // 3. List all active cached users from Redis
  router.get('/users/active', async (_req, res) => {
    try {
      const users = await redisService.getAllActiveUsers();
      res.json({
        success: true,
        data: {
          count: users.length,
          users,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // 4. Query persistent transaction audit logs from file store
  router.get('/logs/transactions', async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const channel = req.query.channel as string | undefined;
      const event = req.query.event as TransactionEvent | undefined;
      const senderId = req.query.senderId as string | undefined;

      const transactions = await loggerService.getRecentTransactions({
        limit,
        channel,
        event,
        senderId,
      });

      res.json({
        success: true,
        data: {
          count: transactions.length,
          transactions,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  // 5. Persistent file store logger statistics
  router.get('/logs/stats', (_req, res) => {
    try {
      const stats = loggerService.getStats();
      res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: msg });
    }
  });

  return router;
}
