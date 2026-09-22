/** Safe native /info snapshot; no pi session filename or credentials. */
export interface SessionInfoDTO {
  chatId: string;
  sessionId: string;
  mode: 'normal' | 'plan';
  selectedModel: { providerId: string; modelId: string } | null;
  currentModel: { providerId: string; modelId: string } | null;
  lastUsedModel: { providerId: string; modelId: string } | null;
  scope: 'pi-session';
  context: { tokens: number | null; contextWindow: number | null; percent: number | null };
  messages: { total: number; user: number; assistant: number };
  tools: { calls: number; results: number };
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | null;
  usageStatus: 'reported' | 'partial' | 'unavailable';
  cost: number | null;
  costStatus: 'estimated' | 'partial' | 'unavailable';
}

export function formatSessionInfo(info: SessionInfoDTO): string {
  const pair = (model: SessionInfoDTO['currentModel']): string => model === null
    ? 'unavailable' : `${model.providerId} / ${model.modelId}`;
  const count = (value: number | null): string => value === null ? 'unavailable' : String(value);
  const context = info.context;
  const tokens = info.tokens;
  return [
    `Model (current session): ${pair(info.currentModel)}`,
    `Model (last used, active branch): ${pair(info.lastUsedModel)}`,
    `Selected model: ${info.selectedModel === null ? 'Default' : pair(info.selectedModel)}`,
    `Context: ${count(context.tokens)} / ${count(context.contextWindow)} tokens (${context.percent === null ? 'unavailable' : `${context.percent.toFixed(1)}%`}) (SDK estimate)`,
    'Scope: pi session, all branches (not chat lifetime; context is active branch)',
    `Messages: ${String(info.messages.total)} (user: ${String(info.messages.user)}, assistant: ${String(info.messages.assistant)})`,
    `Tokens: ${tokens === null ? 'unavailable' : String(tokens.total)}${info.usageStatus === 'partial' ? ' (partial)' : ''}`,
    ...(tokens === null ? [] : [`Input: ${String(tokens.input)} · Output: ${String(tokens.output)} · Cache read: ${String(tokens.cacheRead)} · Cache write: ${String(tokens.cacheWrite)}`]),
    `Cost: ${info.cost === null ? 'unavailable' : `$${info.cost.toFixed(4)} (estimate)`}${info.costStatus === 'partial' ? ' (partial; some pricing unavailable)' : ''}`,
    `Tools: ${String(info.tools.calls)} calls / ${String(info.tools.results)} results`,
    `Mode: ${info.mode}`,
    `Chat ID: ${info.chatId}`,
    `Session ID: ${info.sessionId}`,
  ].join('\n');
}
