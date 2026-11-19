import { redisService } from './redis.service.js';
import { ChannelInfo } from '../types/index.js';

export const DEFAULT_CHANNELS: Array<{ name: string; description: string }> = [
  { name: 'general', description: 'General public discussion room' },
  { name: 'tech', description: 'Engineering, architecture & development room' },
  { name: 'announcements', description: 'System-wide announcements & alerts' },
  { name: 'random', description: 'Casual watercooler chat' },
];

export class ChannelService {
  /**
   * Seed default system channels into Redis
   */
  public async initializeDefaultChannels(): Promise<void> {
    for (const channel of DEFAULT_CHANNELS) {
      await redisService.registerChannel(channel.name, channel.description, true);
    }
  }

  /**
   * List all channels with current active counts
   */
  public async listChannels(): Promise<ChannelInfo[]> {
    return redisService.getAllChannels();
  }

  /**
   * Join a channel: adds user to Redis set & updates user channels
   */
  public async joinChannel(channel: string, userId: string): Promise<number> {
    const cleanChannel = channel.toLowerCase().trim();
    await redisService.addUserToChannel(cleanChannel, userId);
    return redisService.getChannelUserCount(cleanChannel);
  }

  /**
   * Leave a channel
   */
  public async leaveChannel(channel: string, userId: string): Promise<number> {
    const cleanChannel = channel.toLowerCase().trim();
    await redisService.removeUserFromChannel(cleanChannel, userId);
    return redisService.getChannelUserCount(cleanChannel);
  }

  /**
   * Get user IDs inside a channel
   */
  public async getChannelMembers(channel: string): Promise<string[]> {
    const cleanChannel = channel.toLowerCase().trim();
    return redisService.getChannelUsers(cleanChannel);
  }

  /**
   * Check if channel exists or create on demand
   */
  public async ensureChannel(channel: string, description?: string): Promise<void> {
    const cleanChannel = channel.toLowerCase().trim();
    await redisService.registerChannel(cleanChannel, description || `Channel #${cleanChannel}`, false);
  }
}

export const channelService = new ChannelService();
