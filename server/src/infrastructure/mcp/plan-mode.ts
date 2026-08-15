/** Stable pi tool name for one MCP capability. */
export function mcpToolName(serverId: string, capabilityName: string): string {
  return `mcp_${serverId.replace(/[^a-zA-Z0-9]/g, '_')}_${capabilityName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

/** MCP annotations are advisory, but unannotated tools fail closed in Plan Mode. */
export function hasReadOnlyHint(metadata: Record<string, unknown>): boolean {
  const annotations = metadata['annotations'];
  return typeof annotations === 'object' && annotations !== null
    && (annotations as Record<string, unknown>)['readOnlyHint'] === true;
}
