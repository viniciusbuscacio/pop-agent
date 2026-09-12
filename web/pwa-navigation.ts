/** Server-owned downloads and APIs must never resolve to the cached app shell. */
export const navigationFallbackDenylist = [
  /[?&]_pop_refresh=/,
  /^\/v1\//,
  /^\/healthz$/,
  /^\/files\/download(?:\?|$)/,
  /^\/(?:cli|local-access|runtime\/node)\//,
  /^\/install(?:-local-access)?\.(?:sh|ps1)(?:\?|$)/,
  /^\/local-access-(?:installer|update\.json)(?:\?|$)/,
  /^\/(?:cli-latest|cli-[0-9A-Za-z.-]+)\.tgz(?:\?|$)/,
];
