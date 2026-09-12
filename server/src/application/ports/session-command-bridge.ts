export interface SessionStatsResult {
  sessionId: string;
  sessionFile?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  context?: { tokens: number; contextWindow: number; percent: number };
}

export interface SessionForkPoint {
  entryId: string;
  text: string;
  userMessageIndex: number;
}

export interface SessionCommandBridge {
  compact(chatId: string, instructions?: string): Promise<void>;
  sessionStats(chatId: string): Promise<SessionStatsResult>;
  setSessionName(chatId: string, name: string): Promise<void>;
  exportSession(chatId: string, format: 'html' | 'jsonl'): Promise<{ name: string; bytes: Buffer }>;
  forkPoints(chatId: string): Promise<SessionForkPoint[]>;
  forkSession(chatId: string, entryId: string): Promise<{ sessionFile: string }>;
}
