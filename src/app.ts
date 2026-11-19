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
  const publicDir = path.resolve(process.cwd(), 'public');
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

  // Root dashboard and static asset handlers (Serverless compatible)
  app.get('/', (_req: Request, res: Response) => {
    const indexPath = path.resolve(process.cwd(), 'public/index.html');
    try {
      if (fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath, 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }
    } catch (e) {
      console.warn('Could not read index.html:', e);
    }

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
  });

  app.get('/style.css', (_req: Request, res: Response) => {
    const cssPath = path.resolve(process.cwd(), 'public/style.css');
    try {
      if (fs.existsSync(cssPath)) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        return res.send(fs.readFileSync(cssPath, 'utf8'));
      }
    } catch {}
    res.status(404).send('/* style not found */');
  });

  app.get('/app.js', (_req: Request, res: Response) => {
    const jsPath = path.resolve(process.cwd(), 'public/app.js');
    try {
      if (fs.existsSync(jsPath)) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        return res.send(fs.readFileSync(jsPath, 'utf8'));
      }
    } catch {}
    res.status(404).send('// app script not found');
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
