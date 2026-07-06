import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public', 'menubar']),

  // Browser app code (React)
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^(motion$|[A-Z_])',
        argsIgnorePattern: '^[A-Z_]',
      }],
    },
  },

  // Node-context files: build config, sync pipeline, helper scripts.
  // These use `process`, `Buffer`, etc. — lint them with node globals so the
  // build config and the .mjs sync scripts are actually covered (previously
  // they were flagged with bogus `process is not defined` or not linted).
  {
    files: [
      '*.{js,mjs}',
      'sync/**/*.mjs',
      'scripts/**/*.{js,mjs}',
    ],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // These scripts intentionally swallow per-entry fs/JSON errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
