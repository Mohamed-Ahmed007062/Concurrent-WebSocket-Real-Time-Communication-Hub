import type { VercelRequest, VercelResponse } from '@vercel/node';
import http from 'http';
import { createApp } from '../src/app.js';
import { createWebSocketServer } from '../src/websocket.js';
import { redisService } from '../src/services/redis.service.js';
import { channelService } from '../src/services/channel.service.js';

let appInstance: any;
let ioInstance: any;
let initialized = false;

function getApp() {
  if (!appInstance) {
    appInstance = createApp(() => ioInstance);
    const server = http.createServer(appInstance);
    ioInstance = createWebSocketServer(server);
  }
  return appInstance;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const app = getApp();

    if (!initialized) {
      try {
        await redisService.connect();
        await channelService.initializeDefaultChannels();
      } catch (e) {
        console.warn('Vercel initialization warning:', e);
      }
      initialized = true;
    }

    return (app as any)(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('Unhandled Vercel serverless error:', err);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Vercel Serverless Invocation Error',
        message: msg,
        url: req.url,
        stack,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
