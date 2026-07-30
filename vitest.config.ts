import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The pi SDK is a large prebuilt ESM bundle; piping it through vitest's
    // module transformer takes tens of seconds. Import it as-is from disk.
    server: {
      deps: {
        external: [/@earendil-works\/pi-coding-agent/],
      },
    },
  },
});
