/** Identity compiled into this browser/PWA bundle, never borrowed from the server. */
export const LOCAL_POP_AGENT_VERSION =
  typeof __POP_AGENT_VERSION__ === 'undefined' ? 'development' : __POP_AGENT_VERSION__;
