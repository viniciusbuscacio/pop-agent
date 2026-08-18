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
    // Type-aware promise safety covers every production TypeScript path.
    files: ['server/src/**/*.ts', 'cli/src/**/*.ts', 'web/src/**/*.ts', 'web/src/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { disallowTypeAnnotations: false, fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // Plain-JS build scripts run under Node. TypeScript files get this from
    // the compiler, but no-undef still applies to .mjs.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    // The services layer is the only door to the outside (docs/specs/Spec-Pop-General.md §14).
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
