import { ApiResponse, ChannelInfo, ChatMessage, UserSession } from './index.js';

export interface ClientToServerEvents {
  'channel:join': (
    data: { channel: string },
    callback?: (response: ApiResponse<{ channel: string; userCount: number }>) => void
  ) => void;

  'channel:leave': (
    data: { channel: string },
    callback?: (response: ApiResponse<{ channel: string }>) => void
  ) => void;

  'channel:list': (
    callback: (response: ApiResponse<{ channels: ChannelInfo[] }>) => void
  ) => void;

  'message:channel': (
    data: { channel: string; content: string },
    callback?: (response: ApiResponse<{ messageId: string; transactionId: string; timestamp: string }>) => void
  ) => void;

  'message:direct': (
    data: { recipientId: string; content: string },
    callback?: (response: ApiResponse<{ messageId: string; transactionId: string; timestamp: string }>) => void
  ) => void;

  'typing:start': (data: { channel?: string; recipientId?: string }) => void;
  'typing:stop': (data: { channel?: string; recipientId?: string }) => void;

  'heartbeat:ping': (
    data: { clientTimestamp: number },
    callback: (response: { serverTimestamp: number; latencyMs: number }) => void
  ) => void;

  'users:active': (
    callback: (response: ApiResponse<{ users: UserSession[] }>) => void
  ) => void;
}

export interface ServerToClientEvents {
  'message:broadcast': (message: ChatMessage) => void;
  'message:direct': (message: ChatMessage) => void;
  'user:joined_channel': (data: { channel: string; user: { userId: string; username: string }; timestamp: string }) => void;
  'user:left_channel': (data: { channel: string; user: { userId: string; username: string }; timestamp: string }) => void;
  'user:presence_update': (data: { userId: string; username: string; status: 'online' | 'offline'; timestamp: string }) => void;
  'typing:indicator': (data: { userId: string; username: string; channel?: string; recipientId?: string; isTyping: boolean }) => void;
  'error:rate_limit': (data: { message: string; retryAfterMs: number }) => void;
  'error:validation': (data: { message: string; details: unknown }) => void;
  'system:notification': (data: { message: string; timestamp: string; level?: 'info' | 'warn' | 'error' }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  username: string;
  connectedAt: string;
  channels: Set<string>;
}
