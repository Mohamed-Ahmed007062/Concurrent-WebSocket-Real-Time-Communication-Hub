import http from 'http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { createWebSocketServer } from './websocket.js';
import { redisService } from './services/redis.service.js';
import { channelService } from './services/channel.service.js';
import { loggerService } from './services/logger.service.js';

export async function bootstrapServer() {
  let ioInstance: ReturnType<typeof createWebSocketServer>;
  const app = createApp(() => ioInstance);
  const httpServer = http.createServer(app);
  const io = createWebSocketServer(httpServer);
  ioInstance = io;

  try {
    // 1. Initialize & connect Redis
    await redisService.connect();

    // 2. Initialize default communication channels
    await channelService.initializeDefaultChannels();

    // 3. Start listening
    const port = env.PORT;
    const server = httpServer.listen(port, () => {
      console.log(`\n🚀 ========================================================`);
      console.log(`   Real-Time WebSocket Communication Hub running on:`);
      console.log(`   🌐 HTTP & WebSocket Server: http://localhost:${port}`);
      console.log(`   📊 Health & Metrics:        http://localhost:${port}/health`);
      console.log(`   📋 API Channels:            http://localhost:${port}/api/channels`);
      console.log(`   👥 Cached Active Users:     http://localhost:${port}/api/users/active`);
      console.log(`   📝 Persistent Audit Logs:   http://localhost:${port}/api/logs/transactions`);
      console.log(`   🖥️  Live Testing Hub:       http://localhost:${port}/`);
      console.log(`   💾 Redis Caching Mode:      ${redisService.isUsingMock() ? 'In-Memory Mock' : 'Live Standalone'}`);
      console.log(`   📁 Persistent File Store:   ${env.LOG_DIR_RESOLVED}`);
      console.log(`========================================================\n`);
    });

    // 4. Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Commencing graceful shutdown...`);

      // Stop receiving incoming requests
      server.close(async () => {
        console.log('🔒 Closed HTTP server.');

        try {
          // Close WebSocket connections
          io.close(() => {
            console.log('🔌 Closed WebSocket server.');
          });

          // Flush & close persistent file log streams
          await loggerService.close();
          console.log('💾 Flushed all transaction logs to persistent disk store.');

          // Close Redis connection
          await redisService.disconnect();
          console.log('📦 Disconnected Redis database.');

          console.log('👋 Graceful shutdown complete.');
          process.exit(0);
        } catch (err) {
          console.error('❌ Error during shutdown:', err);
          process.exit(1);
        }
      });

      // Force shutdown after timeout
      setTimeout(() => {
        console.error('⏰ Forcefully terminating after shutdown timeout.');
        process.exit(1);
      }, 5000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return { server, io, app };
  } catch (error) {
    console.error('❌ Fatal error bootstrapping server:', error);
    process.exit(1);
  }
}

// Automatically start server when executed directly
if (process.env.NODE_ENV !== 'test') {
  bootstrapServer();
}
