import { z } from 'zod';
import { env } from '../config/env.js';

export const channelNameSchema = z
  .string()
  .min(1, 'Channel name cannot be empty')
  .max(50, 'Channel name exceeds 50 characters')
  .regex(/^[a-zA-Z0-9_\-]+$/, 'Channel name must contain only alphanumeric characters, dashes, and underscores');

export const joinChannelSchema = z.object({
  channel: channelNameSchema,
});

export const leaveChannelSchema = z.object({
  channel: channelNameSchema,
});

export const channelMessageSchema = z.object({
  channel: channelNameSchema,
  content: z
    .string()
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(env.MAX_MESSAGE_LENGTH, `Message exceeds maximum length of ${env.MAX_MESSAGE_LENGTH} characters`),
});

export const directMessageSchema = z.object({
  recipientId: z.string().trim().min(1, 'Recipient ID is required'),
  content: z
    .string()
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(env.MAX_MESSAGE_LENGTH, `Message exceeds maximum length of ${env.MAX_MESSAGE_LENGTH} characters`),
});

export const authHandshakeSchema = z.object({
  userId: z.string().min(1, 'User ID is required').optional(),
  username: z.string().min(2, 'Username must be at least 2 characters').max(32, 'Username cannot exceed 32 characters').trim(),
});
