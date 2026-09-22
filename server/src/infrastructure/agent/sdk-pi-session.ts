import type { AgentSession, AgentSessionEvent, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { RunUsage } from '../../application/ports/agent-bridge.js';
import type { ExecutionMode } from '../../domain/chat/chat.js';
import type { SessionForkPoint, SessionStatsResult } from '../../application/ports/session-command-bridge.js';
import { PiEngineError, type PiImage, type PiSession, type ToolGuard } from './pi-engine.js';

export class SdkPiSession implements PiSession {
  constructor(
    private readonly session: AgentSession,
    private readonly runtime: ModelRuntime,
    private readonly guardSlot: { current: ToolGuard | undefined },
    private readonly normalToolNames: string[],
    private readonly planToolNames: string[],
    public supportsImages: boolean = false,
    private readonly takeAdditionalUsage: () => Array<RunUsage & { purpose: string }> = () => [],
    private readonly contextWindowKnown: (providerId: string, modelId: string) => boolean = () => true,
  ) {}

  setExecutionMode(mode: ExecutionMode): void {
    this.session.setActiveToolsByName(mode === 'plan' ? this.planToolNames : this.normalToolNames);
  }

  setGuard(guard: ToolGuard | undefined): void {
    this.guardSlot.current = guard;
  }

  drainAdditionalUsage(): Array<RunUsage & { purpose: string }> {
    return this.takeAdditionalUsage();
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  prompt(text: string, images?: PiImage[]): Promise<void> {
    if (images === undefined || images.length === 0) return this.session.prompt(text);
    // Only reached when the model accepts image input (the bridge checks
    // supportsImages first): send the images inline as multimodal content.
    return this.session.prompt(text, {
      images: images.map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
      })),
    });
  }

  steer(text: string, images?: PiImage[]): Promise<void> {
    return this.session.steer(
      text,
      images?.map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
      })),
    );
  }

  setSteeringMode(mode: 'all' | 'one-at-a-time'): void {
    this.session.setSteeringMode(mode);
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    return this.session.clearQueue();
  }

  abort(): Promise<void> {
    return this.session.abort();
  }

  async compact(instructions?: string): Promise<void> {
    await this.session.compact(instructions);
  }

  stats(): SessionStatsResult {
    const stats = this.session.getSessionStats();
    const context = stats.contextUsage;
    const model = this.session.model;
    const last = this.session.sessionManager.getBranch().slice().reverse()
      .find((entry) => entry.type === 'message' && entry.message.role === 'assistant');
    const lastMessage = last?.type === 'message' && last.message.role === 'assistant' ? last.message : undefined;
    // SDK totals are authoritative. Inspect availability, not a second accounting
    // ledger: provider adapters may encode absent usage/pricing as zero.
    const usages = this.session.sessionManager.getEntries().flatMap((entry) => {
      if (entry.type === 'compaction' || entry.type === 'branch_summary') return [entry.usage];
      if (entry.type !== 'message') return [];
      if (entry.message.role === 'assistant') return [entry.message.usage];
      if (entry.message.role === 'toolResult' && entry.message.usage !== undefined) return [entry.message.usage];
      return [];
    });
    const knownUsage = usages.filter((usage) => usage !== undefined &&
      [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every((n) => Number.isFinite(n) && n >= 0) &&
      usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0).length;
    const knownCost = usages.filter((usage) => usage !== undefined && Number.isFinite(usage.cost?.total) && usage.cost.total > 0).length;
    const usageStatus = knownUsage === usages.length ? 'reported' : knownUsage > 0 ? 'partial' : 'unavailable';
    const costStatus = knownCost === usages.length ? 'estimated' : knownCost > 0 ? 'partial' : 'unavailable';
    const knownWindow = model !== undefined && this.contextWindowKnown(model.provider, model.id) &&
      context !== undefined && Number.isFinite(context.contextWindow) && context.contextWindow > 0;
    const finite = (value: number | null | undefined): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    return {
      sessionId: stats.sessionId,
      ...(model === undefined ? {} : { currentModel: { providerId: model.provider, modelId: model.id } }),
      ...(lastMessage === undefined ? {} : { lastUsedModel: { providerId: lastMessage.provider, modelId: lastMessage.responseModel ?? lastMessage.model } }),
      infoContext: {
        tokens: finite(context?.tokens),
        contextWindow: knownWindow ? context.contextWindow : null,
        percent: knownWindow ? finite(context.percent) : null,
      },
      usageStatus,
      costStatus,
      ...(stats.sessionFile === undefined ? {} : { sessionFile: stats.sessionFile }),
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls,
      toolResults: stats.toolResults,
      totalMessages: stats.totalMessages,
      tokens: stats.tokens,
      cost: stats.cost,
      ...(context?.tokens === null || context?.percent === null || context === undefined
        ? {}
        : { context: { tokens: context.tokens, contextWindow: context.contextWindow, percent: context.percent } }),
    };
  }

  setName(name: string): void {
    if (this.session.sessionName !== name) this.session.setSessionName(name);
  }

  export(format: 'html' | 'jsonl', outputPath: string): Promise<string> {
    return format === 'html'
      ? this.session.exportToHtml(outputPath)
      : Promise.resolve(this.session.exportToJsonl(outputPath));
  }

  forkPoints(): SessionForkPoint[] {
    const active = new Set(
      this.session.sessionManager.getBranch()
        .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
        .map((entry) => entry.id),
    );
    return this.session.getUserMessagesForForking()
      .filter((point) => active.has(point.entryId))
      .map((point, userMessageIndex) => ({ ...point, userMessageIndex }));
  }

  fork(entryId: string): string {
    const selected = this.session.sessionManager.getEntry(entryId);
    if (selected?.type !== 'message' || selected.message.role !== 'user') {
      throw new Error('Invalid user message for fork.');
    }
    const file = this.session.sessionFile;
    if (file === undefined) throw new Error('The session has not been saved yet.');
    const manager = this.session.sessionManager;
    const copy = (manager.constructor as typeof import('@earendil-works/pi-coding-agent').SessionManager)
      .open(file, manager.getSessionDir(), manager.getCwd());
    const forked = selected.parentId === null
      ? copy.newSession({ parentSession: file })
      : copy.createBranchedSession(selected.parentId);
    if (forked === undefined) throw new Error('Could not create the forked session.');
    return forked;
  }

  async setModel(providerId: string, modelId: string): Promise<void> {
    const model = this.runtime.getModel(providerId, modelId);
    if (model === undefined) {
      throw new PiEngineError('model_not_available', `${providerId} has no model "${modelId}"`);
    }
    this.supportsImages = model.input.includes('image');
    await this.session.setModel(model);
  }

  dispose(): void {
    this.session.dispose();
  }

  get sessionFile(): string | undefined {
    return this.session.sessionFile;
  }

  getLeafId(): string | null {
    return this.session.sessionManager.getLeafId();
  }

  rewindToLeaf(leafId: string | null): void {
    if (leafId === null) this.session.sessionManager.resetLeaf();
    else this.session.sessionManager.branch(leafId);
    const sessionContext = this.session.sessionManager.buildSessionContext();
    this.session.agent.state.messages = sessionContext.messages;
  }
}
