import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
};

type TypeScriptConfig = {
  compilerOptions?: Record<string, unknown>;
  include?: string[];
};

const rootPath = (...segments: string[]) => resolve(process.cwd(), ...segments);

test('enforces the executable project contract', () => {
  const packageJson = JSON.parse(
    readFileSync(rootPath('package.json'), 'utf8'),
  ) as PackageJson;
  const scripts = packageJson.scripts ?? {};

  expect(scripts.build, 'PROJECT_CONTRACT:build script is required').toBe(
    'npm run typecheck',
  );
  expect(scripts.start, 'PROJECT_CONTRACT:start script is required').toBe(
    'node server.js',
  );
  expect(
    scripts.typecheck,
    'PROJECT_CONTRACT:typecheck script is required',
  ).toBe('tsc --noEmit');
  expect(scripts.lint).toBe('eslint . --max-warnings=0');
  expect(scripts.lint).toContain('--max-warnings=0');
  expect(scripts.test).toBe('playwright test');
  expect(scripts['test:api']).toBe('playwright test tests/api');
  expect(scripts['test:ui']).toBe('playwright test tests/ui');
  expect(scripts['test:repeat']).toBe(
    'playwright test --repeat-each=3 --retries=0',
  );

  const tsconfigPath = rootPath('tsconfig.json');
  expect(existsSync(tsconfigPath)).toBe(true);

  const tsconfig = JSON.parse(
    readFileSync(tsconfigPath, 'utf8'),
  ) as TypeScriptConfig;
  expect(tsconfig.compilerOptions).toMatchObject({
    target: 'ES2022',
    module: 'CommonJS',
    moduleResolution: 'Node',
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
    esModuleInterop: true,
  });
  expect(tsconfig.include).toEqual(['playwright.config.ts', 'tests/**/*.ts']);
});
