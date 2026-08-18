import type {
  ProviderSubscriptionUsage,
  ProviderUsageWindow,
} from '../../application/ports/agent-bridge.js';

/** Keep the unstable provider payload at the edge and discard identity fields. */
export function parseOpenAISubscriptionUsage(value: unknown): ProviderSubscriptionUsage {
  const root = record(value);
  const rateLimit = record(root['rate_limit']);
  const primary = parseUsageWindow(rateLimit['primary_window']);
  const secondaryValue = rateLimit['secondary_window'];
  const secondary = secondaryValue === null || secondaryValue === undefined
    ? undefined
    : parseUsageWindow(secondaryValue);
  const plan = root['plan_type'];
  const allowed = rateLimit['allowed'];
  const limitReached = rateLimit['limit_reached'];
  if (typeof plan !== 'string' || typeof allowed !== 'boolean' || typeof limitReached !== 'boolean') {
    throw new Error('OpenAI subscription usage response was malformed');
  }
  return {
    plan,
    allowed,
    limitReached,
    primary,
    ...(secondary === undefined ? {} : { secondary }),
  };
}

function parseUsageWindow(value: unknown): ProviderUsageWindow {
  const window = record(value);
  const usedPercent = window['used_percent'];
  const windowSeconds = window['limit_window_seconds'];
  const resetAt = window['reset_at'];
  if (
    typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) ||
    typeof windowSeconds !== 'number' || !Number.isFinite(windowSeconds) ||
    typeof resetAt !== 'number' || !Number.isFinite(resetAt)
  ) throw new Error('OpenAI subscription usage window was malformed');
  return { usedPercent, windowSeconds, resetAt };
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OpenAI subscription usage response was malformed');
  }
  return value as Record<string, unknown>;
}
