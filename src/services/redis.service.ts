import { Redis, type Redis as RedisClient } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { env } from '../config/env.js';
import { ChannelInfo, UserSession } from '../types/index.js';

export class RedisService {
  private client!: RedisClient;
  private isMock = false;
  private isConnected = false;

  private readonly PREFIX_USER = 'chat:user:';
  private readonly PREFIX_SOCKET = 'chat:socket:';
  private readonly PREFIX_CHANNEL_USERS = 'chat:channel:';
  private readonly PREFIX_USER_CHANNELS = 'chat:user_channels:';
  private readonly KEY_ACTIVE_USERS = 'chat:active_users';
  private readonly KEY_CHANNELS = 'chat:channels';
  private readonly PREFIX_CHANNEL_META = 'chat:channel_meta:';

  constructor() {
    this.init();
  }

  private init() {
    const isTest = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';
    const isVercelWithoutExternal = !!process.env.VERCEL && (!process.env.REDIS_URL || process.env.REDIS_URL.includes('127.0.0.1'));
    if (env.USE_REDIS_MOCK === 'true' || (env.USE_REDIS_MOCK === 'auto' && (isTest || isVercelWithoutExternal))) {
      this.client = new (RedisMock as any)();
      this.isMock = true;
      this.isConnected = true;
      if (!isTest) {
        console.log('📦 Redis initialized in In-Memory Mock Mode.');
      }
    } else {
      // Create real Redis client
      this.client = new Redis(env.REDIS_URL, {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        retryStrategy: (times: number) => {
          if (env.USE_REDIS_MOCK === 'auto') {
            // After 1 attempt, stop retrying real redis and fallback to mock
            return null;
          }
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.isMock = false;
        console.log(`⚡ Connected to Redis database at ${env.REDIS_HOST}:${env.REDIS_PORT}`);
      });

      this.client.on('error', (err) => {
        if (env.USE_REDIS_MOCK === 'auto' && !this.isMock) {
          console.warn(`⚠️ Redis server unreachable (${err.message}). Falling back to In-Memory Redis Mock.`);
          this.fallbackToMock();
        } else if (!this.isMock) {
          console.error('❌ Redis Error:', err.message);
        }
      });
    }
  }

  public async connect(): Promise<void> {
    if (this.isMock) {
      this.isConnected = true;
      return;
    }

    try {
      await this.client.connect();
      this.isConnected = true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (env.USE_REDIS_MOCK === 'auto') {
        console.warn(`⚠️ Failed to connect to Redis (${errorMsg}). Switching to In-Memory Mock.`);
        this.fallbackToMock();
      } else {
        throw err;
      }
    }
  }

  private fallbackToMock() {
    try {
      this.client.disconnect();
    } catch {
      // Ignore disconnect error
    }
    this.client = new (RedisMock as any)();
    this.isMock = true;
    this.isConnected = true;
    console.log('✅ In-Memory Redis Mock active and ready.');
  }

  /**
   * Cache active user session in Redis hash and update active users set
   */
  public async cacheUserSession(session: UserSession): Promise<void> {
    const userKey = `${this.PREFIX_USER}${session.userId}`;
    const socketKey = `${this.PREFIX_SOCKET}${session.socketId}`;

    const pipeline = this.client.pipeline();

    // Cache user session data
    pipeline.hset(userKey, {
      userId: session.userId,
      username: session.username,
      socketId: session.socketId,
      connectedAt: session.connectedAt,
      lastActiveAt: session.lastActiveAt,
      channels: JSON.stringify(session.channels),
      clientIp: session.clientIp || '',
      userAgent: session.userAgent || '',
    });

    // Add to active users set
    pipeline.sadd(this.KEY_ACTIVE_USERS, session.userId);

    // Map socket ID -> userId for O(1) reverse lookup on disconnect
    pipeline.set(socketKey, session.userId);

    await pipeline.exec();
  }

  /**
   * Retrieve cached user session by userId
   */
  public async getUserSession(userId: string): Promise<UserSession | null> {
    const userKey = `${this.PREFIX_USER}${userId}`;
    const data = await this.client.hgetall(userKey);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      userId: data.userId,
      username: data.username,
      socketId: data.socketId,
      connectedAt: data.connectedAt,
      lastActiveAt: data.lastActiveAt,
      channels: data.channels ? JSON.parse(data.channels) : [],
      clientIp: data.clientIp || undefined,
      userAgent: data.userAgent || undefined,
    };
  }

  /**
   * Reverse lookup: find user session by socket ID
   */
  public async getUserBySocketId(socketId: string): Promise<UserSession | null> {
    const socketKey = `${this.PREFIX_SOCKET}${socketId}`;
    const userId = await this.client.get(socketKey);

    if (!userId) {
      return null;
    }

    return this.getUserSession(userId);
  }

  /**
   * Remove user session and cleanup from channels on disconnect
   */
  public async removeUserSession(userId: string, socketId: string): Promise<void> {
    const userKey = `${this.PREFIX_USER}${userId}`;
    const socketKey = `${this.PREFIX_SOCKET}${socketId}`;
    const userChannelsKey = `${this.PREFIX_USER_CHANNELS}${userId}`;

    // Get user's channels before clearing
    const joinedChannels = await this.client.smembers(userChannelsKey);

    const pipeline = this.client.pipeline();

    // Remove from active users set
    pipeline.srem(this.KEY_ACTIVE_USERS, userId);

    // Delete user session hash
    pipeline.del(userKey);

    // Delete socket mapping
    pipeline.del(socketKey);

    // Delete user channels set
    pipeline.del(userChannelsKey);

    // Remove user from all channels they were part of
    for (const channel of joinedChannels) {
      const channelUsersKey = `${this.PREFIX_CHANNEL_USERS}${channel}:users`;
      pipeline.srem(channelUsersKey, userId);
    }

    await pipeline.exec();
  }

  /**
   * Update user heartbeat/lastActiveAt timestamp
   */
  public async updateUserHeartbeat(userId: string, timestamp: string = new Date().toISOString()): Promise<void> {
    const userKey = `${this.PREFIX_USER}${userId}`;
    await this.client.hset(userKey, 'lastActiveAt', timestamp);
  }

  /**
   * Fetch all active users currently cached in Redis
   */
  public async getAllActiveUsers(): Promise<UserSession[]> {
    const userIds = await this.client.smembers(this.KEY_ACTIVE_USERS);
    if (!userIds || userIds.length === 0) {
      return [];
    }

    const users: UserSession[] = [];
    for (const id of userIds) {
      const user = await this.getUserSession(id);
      if (user) {
        users.push(user);
      }
    }

    return users;
  }

  /**
   * Get active user count
   */
  public async getActiveUserCount(): Promise<number> {
    return this.client.scard(this.KEY_ACTIVE_USERS);
  }

  /**
   * Add a user to a channel membership set in Redis
   */
  public async addUserToChannel(channel: string, userId: string): Promise<void> {
    const channelUsersKey = `${this.PREFIX_CHANNEL_USERS}${channel}:users`;
    const userChannelsKey = `${this.PREFIX_USER_CHANNELS}${userId}`;

    const pipeline = this.client.pipeline();
    pipeline.sadd(channelUsersKey, userId);
    pipeline.sadd(userChannelsKey, channel);
    pipeline.sadd(this.KEY_CHANNELS, channel);

    await pipeline.exec();

    // Update user session channels array in hash
    const session = await this.getUserSession(userId);
    if (session) {
      const channels = new Set(session.channels);
      channels.add(channel);
      session.channels = Array.from(channels);
      await this.client.hset(`${this.PREFIX_USER}${userId}`, 'channels', JSON.stringify(session.channels));
    }
  }

  /**
   * Remove a user from a channel
   */
  public async removeUserFromChannel(channel: string, userId: string): Promise<void> {
    const channelUsersKey = `${this.PREFIX_CHANNEL_USERS}${channel}:users`;
    const userChannelsKey = `${this.PREFIX_USER_CHANNELS}${userId}`;

    const pipeline = this.client.pipeline();
    pipeline.srem(channelUsersKey, userId);
    pipeline.srem(userChannelsKey, channel);
    await pipeline.exec();

    // Update user session channels array in hash
    const session = await this.getUserSession(userId);
    if (session) {
      session.channels = session.channels.filter((c) => c !== channel);
      await this.client.hset(`${this.PREFIX_USER}${userId}`, 'channels', JSON.stringify(session.channels));
    }
  }

  /**
   * Get list of userIds inside a channel
   */
  public async getChannelUsers(channel: string): Promise<string[]> {
    const channelUsersKey = `${this.PREFIX_CHANNEL_USERS}${channel}:users`;
    return this.client.smembers(channelUsersKey);
  }

  /**
   * Get count of users inside a channel
   */
  public async getChannelUserCount(channel: string): Promise<number> {
    const channelUsersKey = `${this.PREFIX_CHANNEL_USERS}${channel}:users`;
    return this.client.scard(channelUsersKey);
  }

  /**
   * Register channel metadata
   */
  public async registerChannel(name: string, description: string = '', isDefault: boolean = false): Promise<void> {
    const metaKey = `${this.PREFIX_CHANNEL_META}${name}`;
    await this.client.sadd(this.KEY_CHANNELS, name);
    await this.client.hset(metaKey, {
      name,
      description,
      createdAt: new Date().toISOString(),
      isDefault: String(isDefault),
    });
  }

  /**
   * Get all registered channels with counts
   */
  public async getAllChannels(): Promise<ChannelInfo[]> {
    const channelNames = await this.client.smembers(this.KEY_CHANNELS);
    const result: ChannelInfo[] = [];

    for (const name of channelNames) {
      const meta = await this.client.hgetall(`${this.PREFIX_CHANNEL_META}${name}`);
      const userCount = await this.getChannelUserCount(name);

      result.push({
        name,
        description: meta?.description || `Channel #${name}`,
        userCount,
        createdAt: meta?.createdAt || new Date().toISOString(),
        isDefault: meta?.isDefault === 'true',
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Clear all Redis keys (for testing isolation)
   */
  public async clearAll(): Promise<void> {
    await this.client.flushall();
  }

  /**
   * Health status inspection
   */
  public async isHealthy(): Promise<{
    connected: boolean;
    mode: 'standalone' | 'mock';
    activeUsers: number;
    channelCount: number;
  }> {
    try {
      const [activeUsers, channelCount] = await Promise.all([
        this.getActiveUserCount(),
        this.client.scard(this.KEY_CHANNELS),
      ]);

      return {
        connected: this.isConnected,
        mode: this.isMock ? 'mock' : 'standalone',
        activeUsers,
        channelCount,
      };
    } catch {
      return {
        connected: false,
        mode: this.isMock ? 'mock' : 'standalone',
        activeUsers: 0,
        channelCount: 0,
      };
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // Ignored
    }
    this.isConnected = false;
  }

  public getRawClient(): RedisClient {
    return this.client;
  }

  public isUsingMock(): boolean {
    return this.isMock;
  }
}

// Export singleton instance
export const redisService = new RedisService();
