import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { redisService } from '../src/services/redis.service.js';
import { UserSession } from '../src/types/index.js';

describe('RedisService - In-Memory Database Caching & Presence', () => {
  beforeAll(async () => {
    await redisService.connect();
  });

  beforeEach(async () => {
    await redisService.clearAll();
  });

  afterAll(async () => {
    await redisService.disconnect();
  });

  it('should cache and retrieve active user session', async () => {
    const session: UserSession = {
      userId: 'user_123',
      username: 'Alice',
      socketId: 'sock_abc123',
      connectedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      channels: ['general'],
      clientIp: '127.0.0.1',
    };

    await redisService.cacheUserSession(session);

    const retrieved = await redisService.getUserSession('user_123');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.userId).toBe('user_123');
    expect(retrieved?.username).toBe('Alice');
    expect(retrieved?.socketId).toBe('sock_abc123');
    expect(retrieved?.channels).toContain('general');

    // Reverse lookup by socket ID
    const bySocket = await redisService.getUserBySocketId('sock_abc123');
    expect(bySocket?.userId).toBe('user_123');
  });

  it('should manage channel memberships and user counts accurately', async () => {
    await redisService.addUserToChannel('engineering', 'user_1');
    await redisService.addUserToChannel('engineering', 'user_2');
    await redisService.addUserToChannel('engineering', 'user_3');

    let count = await redisService.getChannelUserCount('engineering');
    expect(count).toBe(3);

    const members = await redisService.getChannelUsers('engineering');
    expect(members).toHaveLength(3);
    expect(members).toContain('user_1');
    expect(members).toContain('user_2');
    expect(members).toContain('user_3');

    // Remove one user
    await redisService.removeUserFromChannel('engineering', 'user_2');
    count = await redisService.getChannelUserCount('engineering');
    expect(count).toBe(2);
  });

  it('should clean up all user references on disconnect', async () => {
    const session: UserSession = {
      userId: 'user_cleanup_test',
      username: 'Bob',
      socketId: 'sock_cleanup',
      connectedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      channels: ['general', 'dev'],
    };

    await redisService.cacheUserSession(session);
    await redisService.addUserToChannel('general', 'user_cleanup_test');
    await redisService.addUserToChannel('dev', 'user_cleanup_test');

    let activeUsers = await redisService.getAllActiveUsers();
    expect(activeUsers.some((u) => u.userId === 'user_cleanup_test')).toBe(true);

    // Disconnect cleanup
    await redisService.removeUserSession('user_cleanup_test', 'sock_cleanup');

    const retrieved = await redisService.getUserSession('user_cleanup_test');
    expect(retrieved).toBeNull();

    const bySocket = await redisService.getUserBySocketId('sock_cleanup');
    expect(bySocket).toBeNull();

    activeUsers = await redisService.getAllActiveUsers();
    expect(activeUsers.some((u) => u.userId === 'user_cleanup_test')).toBe(false);

    const generalMembers = await redisService.getChannelUsers('general');
    expect(generalMembers).not.toContain('user_cleanup_test');
  });

  it('should update user heartbeat timestamp', async () => {
    const session: UserSession = {
      userId: 'user_hb',
      username: 'Charlie',
      socketId: 'sock_hb',
      connectedAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      channels: ['general'],
    };

    await redisService.cacheUserSession(session);

    const newTimestamp = '2026-11-14T22:30:00.000Z';
    await redisService.updateUserHeartbeat('user_hb', newTimestamp);

    const updated = await redisService.getUserSession('user_hb');
    expect(updated?.lastActiveAt).toBe(newTimestamp);
  });
});
