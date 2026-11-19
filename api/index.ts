import type { VercelRequest, VercelResponse } from '@vercel/node';
import http from 'http';
import { createApp } from '../src/app.js';
import { createWebSocketServer } from '../src/websocket.js';
import { redisService } from '../src/services/redis.service.js';
import { channelService } from '../src/services/channel.service.js';

let initialized = false;
let appInstance: any;
let ioInstance: any;

async function ensureInitialized() {
  if (!initialized) {
    try {
      await redisService.connect();
      await channelService.initializeDefaultChannels();
    } catch (e) {
      console.warn('Initialization warning:', e);
    }
    initialized = true;
  }
}

appInstance = createApp(() => ioInstance);
const server = http.createServer(appInstance);
ioInstance = createWebSocketServer(server);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureInitialized();
  return (appInstance as any)(req, res);
}
