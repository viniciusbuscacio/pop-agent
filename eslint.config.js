import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // web/public holds static assets served as-is, including the service-worker
  // push script, which uses the worker global `self` and is not app source.
  { ignores: ['**/dist/**', '**/node_modules/**', '**/dev-dist/**', 'web/public/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Plain-JS build scripts run under Node. TypeScript files get this from
    // the compiler, but no-undef still applies to .mjs.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
  {
    // The services layer is the only door to the outside (popy.spec §14).
    // A component reaching for fetch/EventSource directly fails the gate.
    files: ['web/src/**/*.{ts,tsx}'],
    ignores: ['web/src/services/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Components never call the API directly. Use web/src/services/*.',
        },
        {
          name: 'EventSource',
          message: 'Streams are opened by web/src/services/*, never by a component.',
        },
      ],
    },
  },
);
