import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { env } from '../config/env.js';
import { TransactionEvent, TransactionLog } from '../types/index.js';

export interface TransactionFilter {
  channel?: string;
  event?: TransactionEvent;
  senderId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export class TransactionLoggerService {
  private logDir: string;
  private buffer: TransactionLog[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private currentLogDate: string = '';
  private currentWriteStream: fs.WriteStream | null = null;
  private totalLoggedCount = 0;
  private eventCounts: Record<string, number> = {};

  constructor(logDir: string = env.LOG_DIR_RESOLVED) {
    this.logDir = logDir;
    this.ensureDirectory();
    this.startPeriodicFlush();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getTodayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getLogFilePath(dateStr: string = this.getTodayDateString()): string {
    return path.join(this.logDir, `${env.LOG_FILE_PREFIX}-${dateStr}.jsonl`);
  }

  private getWriteStream(): fs.WriteStream {
    const today = this.getTodayDateString();
    if (!this.currentWriteStream || this.currentLogDate !== today) {
      if (this.currentWriteStream) {
        this.currentWriteStream.end();
      }
      this.currentLogDate = today;
      const filePath = this.getLogFilePath(today);
      this.currentWriteStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    }
    return this.currentWriteStream;
  }

  private startPeriodicFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('Error during scheduled log flush:', err);
      });
    }, env.LOG_FLUSH_INTERVAL_MS);
  }

  /**
   * Log a transaction asynchronously to buffer and persistent store
   */
  public log(entry: Omit<TransactionLog, 'timestamp' | 'epochMs'>): TransactionLog {
    const now = new Date();
    const fullLog: TransactionLog = {
      ...entry,
      timestamp: now.toISOString(),
      epochMs: now.getTime(),
    };

    this.buffer.push(fullLog);
    this.totalLoggedCount++;
    this.eventCounts[fullLog.event] = (this.eventCounts[fullLog.event] || 0) + 1;

    // If buffer exceeds high-water mark, trigger an immediate asynchronous flush
    if (this.buffer.length >= 100) {
      this.flush().catch((err) => {
        console.error('Error during high-watermark log flush:', err);
      });
    }

    return fullLog;
  }

  /**
   * High-throughput batch flush of buffer to persistent disk store
   */
  public async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }

    this.isFlushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      const stream = this.getWriteStream();
      const content = batch.map((item) => JSON.stringify(item)).join('\n') + '\n';

      await new Promise<void>((resolve, reject) => {
        const canWrite = stream.write(content, (err) => {
          if (err) reject(err);
          else resolve();
        });

        if (!canWrite) {
          stream.once('drain', () => resolve());
        }
      });
    } catch (err) {
      // Put unsaved items back at front of buffer
      this.buffer.unshift(...batch);
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Query recent transaction logs directly from persistent file store
   */
  public async getRecentTransactions(filter: TransactionFilter = {}): Promise<TransactionLog[]> {
    // Ensure all memory buffer entries are saved to disk first
    await this.flush();

    const limit = filter.limit || 50;
    const today = this.getTodayDateString();
    const filePath = this.getLogFilePath(today);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const results: TransactionLog[] = [];
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const log: TransactionLog = JSON.parse(line);

        // Apply filters
        if (filter.channel && log.target !== filter.channel) continue;
        if (filter.event && log.event !== filter.event) continue;
        if (filter.senderId && log.senderId !== filter.senderId) continue;

        results.push(log);
      } catch {
        // Skip corrupted line
      }
    }

    // Return most recent first
    return results.reverse().slice(0, limit);
  }

  /**
   * Get operational statistics of persistent logger
   */
  public getStats() {
    return {
      totalLogged: this.totalLoggedCount,
      pendingBufferCount: this.buffer.length,
      currentLogFile: this.getLogFilePath(),
      eventsBreakdown: { ...this.eventCounts },
    };
  }

  /**
   * Cleanup and close file streams on shutdown
   */
  public async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();

    if (this.currentWriteStream) {
      await new Promise<void>((resolve) => {
        this.currentWriteStream!.end(() => resolve());
      });
      this.currentWriteStream = null;
    }
  }
}

// Export singleton instance
export const loggerService = new TransactionLoggerService();
