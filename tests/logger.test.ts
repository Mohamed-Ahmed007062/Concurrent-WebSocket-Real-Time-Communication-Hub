import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { TransactionLoggerService } from '../src/services/logger.service.js';

describe('TransactionLoggerService - Persistent File Store', () => {
  const testLogDir = path.resolve(process.cwd(), './logs/test-run');
  let logger: TransactionLoggerService;

  beforeAll(() => {
    logger = new TransactionLoggerService(testLogDir);
  });

  afterAll(async () => {
    await logger.close();
    // Clean up test log files
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  it('should record transactions with ISO timestamps and transactionId', () => {
    const entry = logger.log({
      transactionId: 'tx-001',
      event: 'MESSAGE_SENT',
      senderId: 'user_1',
      senderUsername: 'Alice',
      target: 'general',
      payloadSize: 42,
      status: 'SUCCESS',
      latencyMs: 3.5,
    });

    expect(entry.transactionId).toBe('tx-001');
    expect(entry.timestamp).toBeDefined();
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
    expect(entry.epochMs).toBeGreaterThan(0);
    expect(entry.status).toBe('SUCCESS');
  });

  it('should flush buffered entries to persistent disk file', async () => {
    logger.log({
      transactionId: 'tx-002',
      event: 'CHANNEL_JOIN',
      senderId: 'user_2',
      senderUsername: 'Bob',
      target: 'tech',
      payloadSize: 20,
      status: 'SUCCESS',
    });

    await logger.flush();

    const stats = logger.getStats();
    expect(stats.totalLogged).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(stats.currentLogFile)).toBe(true);

    const fileContent = fs.readFileSync(stats.currentLogFile, 'utf8');
    expect(fileContent).toContain('tx-002');
    expect(fileContent).toContain('CHANNEL_JOIN');
  });

  it('should read and parse transactions from persistent file store', async () => {
    // Add distinct test transaction
    logger.log({
      transactionId: 'tx-filter-test',
      event: 'DIRECT_MESSAGE_SENT',
      senderId: 'user_direct',
      senderUsername: 'Charlie',
      target: 'user_recipient',
      payloadSize: 100,
      status: 'SUCCESS',
    });

    await logger.flush();

    const allLogs = await logger.getRecentTransactions({ limit: 10 });
    expect(allLogs.length).toBeGreaterThan(0);

    const filterByEvent = await logger.getRecentTransactions({ event: 'DIRECT_MESSAGE_SENT' });
    expect(filterByEvent.some((log) => log.transactionId === 'tx-filter-test')).toBe(true);

    const filterByChannel = await logger.getRecentTransactions({ channel: 'nonexistent-channel' });
    expect(filterByChannel).toHaveLength(0);
  });
});
