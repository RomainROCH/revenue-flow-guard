import playwright from 'eslint-plugin-playwright';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default [
  {
    files: ['playwright.config.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: rootDirectory,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    plugins: {
      playwright,
    },
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      'playwright/prefer-web-first-assertions': 'error',
      'playwright/no-force-option': 'error',
      'playwright/valid-expect': 'error',
    },
  },
  {
    files: ['app/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error',
    },
  },
  {
    files: ['server.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error',
    },
  },
];
