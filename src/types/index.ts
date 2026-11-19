export interface UserSession {
  userId: string;
  username: string;
  socketId: string;
  connectedAt: string; // ISO 8601
  lastActiveAt: string; // ISO 8601
  channels: string[];
  clientIp?: string;
  userAgent?: string;
}

export interface ChatMessage {
  id: string;
  transactionId: string;
  senderId: string;
  senderUsername: string;
  channel?: string;
  recipientId?: string;
  content: string;
  timestamp: string; // ISO 8601 with ms
  type: 'channel' | 'direct' | 'system';
}

export interface ChannelInfo {
  name: string;
  description: string;
  userCount: number;
  createdAt: string;
  isDefault?: boolean;
}

export type TransactionEvent =
  | 'MESSAGE_SENT'
  | 'DIRECT_MESSAGE_SENT'
  | 'CHANNEL_JOIN'
  | 'CHANNEL_LEAVE'
  | 'USER_CONNECT'
  | 'USER_DISCONNECT'
  | 'HEARTBEAT'
  | 'RATE_LIMITED'
  | 'ERROR';

export interface TransactionLog {
  transactionId: string;
  timestamp: string; // ISO 8601
  epochMs: number;
  event: TransactionEvent;
  senderId?: string;
  senderUsername?: string;
  target?: string; // Channel name or recipientId
  payloadSize: number; // bytes
  status: 'SUCCESS' | 'RATE_LIMITED' | 'ERROR';
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  timestamp: string;
}
