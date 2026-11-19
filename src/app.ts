import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHealthRouter } from './routes/health.routes.js';
import { createApiRouter } from './routes/api.routes.js';
import type { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(getIo?: SocketIOServer | (() => SocketIOServer | undefined)) {
  const app = express();

  // Security headers (Allowing inline scripts & styles for the interactive dashboard)
  app.use(
    (helmet as any)({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.socket.io'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS middleware
  app.use(cors());

  // Logging middleware (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static web dashboard assets
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));

  // Mount API routers
  app.use(createHealthRouter(getIo));
  app.use('/api', createApiRouter());
  app.use(createApiRouter());

  app.get('/api', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      message: 'Concurrent WebSocket Real-Time Communication Hub API',
      endpoints: {
        health: '/health',
        channels: '/api/channels',
        activeUsers: '/api/users/active',
        auditLogs: '/api/logs/transactions',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Root redirect / fallback for dashboard
  app.get('/', (_req: Request, res: Response) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath, (err) => {
        if (err && !res.headersSent) {
          res.json({
            status: 'online',
            service: 'Concurrent WebSocket Real-Time Communication Hub',
            endpoints: {
              health: '/health',
              channels: '/api/channels',
              activeUsers: '/api/users/active',
              auditLogs: '/api/logs/transactions',
            },
          });
        }
      });
    } else {
      res.json({
        status: 'online',
        service: 'Concurrent WebSocket Real-Time Communication Hub',
        endpoints: {
          health: '/health',
          channels: '/api/channels',
          activeUsers: '/api/users/active',
          auditLogs: '/api/logs/transactions',
        },
      });
    }
  });

  // 404 Handler for undefined API routes
  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'API endpoint not found',
      timestamp: new Date().toISOString(),
    });
  });

  // Central Error Handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled Application Error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
