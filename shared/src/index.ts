/**
 * Types shared between server and web. The web app never redefines a
 * server type — it imports from here (docs/specs/Spec-Pop-General.md §3, §13).
 */

export * from './protocol.js';
export * from './account-contracts.js';
export * from './chat-contracts.js';
export * from './automation-provider-contracts.js';
export * from './event-contracts.js';
export * from './mcp.js';
export * from './a2a.js';

export * from './integrations.js';
