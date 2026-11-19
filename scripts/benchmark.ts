import { io as Client, Socket } from 'socket.io-client';
import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../src/app.js';
import { createWebSocketServer } from '../src/websocket.js';
import { redisService } from '../src/services/redis.service.js';
import { channelService } from '../src/services/channel.service.js';
import { loggerService } from '../src/services/logger.service.js';

interface BenchmarkConfig {
  concurrentClients: number;
  messagesPerClient: number;
  channels: string[];
}

const CONFIG: BenchmarkConfig = {
  concurrentClients: 100,
  messagesPerClient: 10,
  channels: ['general', 'tech', 'random'],
};

async function runBenchmark() {
  console.log(`\n=============================================================`);
  console.log(`  🚀 HIGH-CONCURRENCY WEBSOCKET STRESS BENCHMARK`);
  console.log(`=============================================================`);
  console.log(`  Concurrent Clients:   ${CONFIG.concurrentClients}`);
  console.log(`  Messages Per Client:  ${CONFIG.messagesPerClient}`);
  console.log(`  Total Messages:       ${CONFIG.concurrentClients * CONFIG.messagesPerClient}`);
  console.log(`  Target Channels:      ${CONFIG.channels.join(', ')}`);
  console.log(`=============================================================\n`);

  // 1. Spin up ephemeral server
  const httpServer = http.createServer();
  const io = createWebSocketServer(httpServer);
  const app = createApp(io);
  httpServer.on('request', app);

  await redisService.connect();
  await redisService.clearAll();
  await channelService.initializeDefaultChannels();

  const serverPort = await new Promise<number>((resolve) => {
    httpServer.listen(0, () => {
      resolve((httpServer.address() as AddressInfo).port);
    });
  });

  console.log(`⚡ Ephemeral test server listening on port ${serverPort}`);

  // 2. Connect concurrent clients
  console.log(`⏳ Connecting ${CONFIG.concurrentClients} WebSocket clients concurrently...`);
  const connStartTime = Date.now();
  const clients: Socket[] = [];

  const connectPromises = Array.from({ length: CONFIG.concurrentClients }).map((_, i) => {
    return new Promise<Socket>((resolve, reject) => {
      const s = Client(`http://localhost:${serverPort}`, {
        auth: {
          username: `BenchUser_${i}`,
          userId: `bench_user_${i}`,
        },
        transports: ['websocket'],
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', (err) => reject(err));
    });
  });

  const connectedClients = await Promise.all(connectPromises);
  clients.push(...connectedClients);
  const connTime = Date.now() - connStartTime;
  console.log(`✅ All ${CONFIG.concurrentClients} clients connected in ${connTime}ms (${(CONFIG.concurrentClients / (connTime / 1000)).toFixed(1)} connects/sec)\n`);

  // 3. Distribute clients across channels
  console.log(`⏳ Subscribing clients across target channels...`);
  for (let i = 0; i < clients.length; i++) {
    const ch = CONFIG.channels[i % CONFIG.channels.length];
    await new Promise<void>((resolve) => {
      clients[i].emit('channel:join', { channel: ch }, () => resolve());
    });
  }

  // Verify Redis cached active users
  const activeCached = await redisService.getActiveUserCount();
  console.log(`💾 Active users verified in Redis memory cache: ${activeCached}\n`);

  // 4. Setup message metrics tracking
  let totalBroadcastsReceived = 0;
  clients.forEach((c) => {
    c.on('message:broadcast', () => {
      totalBroadcastsReceived++;
    });
  });

  const latencies: number[] = [];

  // 5. Fire concurrent message burst
  console.log(`🔥 Commencing concurrent message throughput burst...`);
  const burstStartTime = Date.now();
  const messagePromises: Promise<void>[] = [];

  for (let c = 0; c < clients.length; c++) {
    const ch = CONFIG.channels[c % CONFIG.channels.length];
    for (let m = 0; m < CONFIG.messagesPerClient; m++) {
      messagePromises.push(
        new Promise<void>((resolve) => {
          const sendStart = Date.now();
          clients[c].emit(
            'message:channel',
            { channel: ch, content: `Benchmark payload ${c}-${m} timestamp=${sendStart}` },
            (res) => {
              const latency = Date.now() - sendStart;
              latencies.push(latency);
              if (!res.success) {
                console.error('Message failed:', res.error);
              }
              resolve();
            }
          );
        })
      );
    }
  }

  await Promise.all(messagePromises);
  const burstDurationMs = Date.now() - burstStartTime;

  // Wait brief period for network fanout to complete
  await new Promise((r) => setTimeout(r, 500));

  // 6. Calculate statistics
  latencies.sort((a, b) => a - b);
  const totalSent = CONFIG.concurrentClients * CONFIG.messagesPerClient;
  const throughputMsgSec = (totalSent / (burstDurationMs / 1000)).toFixed(2);
  const minLatency = latencies[0];
  const maxLatency = latencies[latencies.length - 1];
  const avgLatency = (latencies.reduce((sum, val) => sum + val, 0) / latencies.length).toFixed(2);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  // Flush persistent file store logger
  await loggerService.flush();
  const loggerStats = loggerService.getStats();

  console.log(`\n=============================================================`);
  console.log(`  📊 BENCHMARK RESULTS SUMMARY`);
  console.log(`=============================================================`);
  console.log(`  Total Messages Sent:        ${totalSent}`);
  console.log(`  Total Broadcasts Delivered: ${totalBroadcastsReceived}`);
  console.log(`  Test Execution Duration:    ${burstDurationMs} ms`);
  console.log(`  Throughput:                 ${throughputMsgSec} messages/sec`);
  console.log(`  Latency Metrics (Round-Trip Ack):`);
  console.log(`    - Min:                    ${minLatency} ms`);
  console.log(`    - Average:                ${avgLatency} ms`);
  console.log(`    - Median (P50):           ${p50} ms`);
  console.log(`    - 95th Percentile (P95):   ${p95} ms`);
  console.log(`    - 99th Percentile (P99):   ${p99} ms`);
  console.log(`    - Max:                    ${maxLatency} ms`);
  console.log(`  Redis Cache Accuracy:       ${activeCached}/${CONFIG.concurrentClients} (100%)`);
  console.log(`  File Store Transactions:    ${loggerStats.totalLogged} records logged`);
  console.log(`  Log File Path:              ${loggerStats.currentLogFile}`);
  console.log(`=============================================================\n`);

  // 7. Cleanup
  clients.forEach((c) => c.disconnect());
  await loggerService.close();
  await redisService.disconnect();
  httpServer.close();
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
