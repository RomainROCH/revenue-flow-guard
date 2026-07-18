import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[];
};

type TypeScriptConfig = {
  compilerOptions?: Record<string, unknown>;
  include?: string[];
};

type SitesAppPackageJson = {
  name: string;
  private: boolean;
  type: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const rootPath = (...segments: string[]) => resolve(process.cwd(), ...segments);

test('enforces the executable project contract', () => {
  const packageJson = JSON.parse(
    readFileSync(rootPath('package.json'), 'utf8'),
  ) as PackageJson;
  const scripts = packageJson.scripts ?? {};

  expect(
    packageJson.workspaces,
    'PROJECT_CONTRACT:workspaces field is required',
  ).toEqual(['sites-app']);

  expect(scripts.build, 'PROJECT_CONTRACT:build script is required').toBe(
    'npm run typecheck && npm run build:site',
  );
  expect(scripts.start, 'PROJECT_CONTRACT:start script is required').toBe(
    'node server.js',
  );
  expect(
    scripts['build:site'],
    'PROJECT_CONTRACT:build:site script is required',
  ).toBe(
    'npm run build --workspace revenue-flow-guard-site && node scripts/finalize-site-build.mjs',
  );
  expect(
    scripts['start:site'],
    'PROJECT_CONTRACT:start:site script is required',
  ).toBe('npm run start --workspace revenue-flow-guard-site --');
  expect(
    scripts.typecheck,
    'PROJECT_CONTRACT:typecheck script is required',
  ).toBe(
    'tsc --noEmit && npm run typecheck --workspace revenue-flow-guard-site',
  );
  expect(scripts.lint).toBe('eslint . --max-warnings=0');
  expect(scripts.lint).toContain('--max-warnings=0');
  expect(scripts.test).toBe('playwright test');
  expect(scripts['test:api']).toBe('playwright test tests/api');
  expect(scripts['test:ui']).toBe('playwright test tests/ui');
  expect(scripts['test:repeat']).toBe(
    'playwright test --repeat-each=3 --retries=0',
  );

  expect(
    scripts['test:sites'],
    'PROJECT_CONTRACT:test:sites script is required',
  ).toBe('npm run build && playwright test --config playwright.sites.config.ts');

  expect(
    scripts['test:sites:public'],
    'PROJECT_CONTRACT:test:sites:public script is required',
  ).toBe(
    'node scripts/validate-sites-public-url.mjs && playwright test --config playwright.sites-public.config.ts',
  );

  const devDeps = packageJson.devDependencies ?? {};
  expect(devDeps.wrangler, 'PROJECT_CONTRACT:wrangler must be removed').toBeUndefined();

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
  expect(tsconfig.include).toEqual([
    'playwright.config.ts',
    'playwright.sites.config.ts',
    'playwright.sites-public.config.ts',
    'tests/**/*.ts',
  ]);

  const playwrightConfigText = readFileSync(
    rootPath('playwright.config.ts'),
    'utf8',
  );
  const testIgnoreMatch = playwrightConfigText.match(/testIgnore:\s*(\[[^\]]*\])/);
  expect(
    testIgnoreMatch,
    'PROJECT_CONTRACT:testIgnore is required in playwright.config.ts',
  ).not.toBeNull();
  const testIgnore = JSON.parse(testIgnoreMatch![1].replace(/'/g, '"'));
  expect(
    testIgnore,
    'PROJECT_CONTRACT:testIgnore must contain both sites and sites-public globs',
  ).toEqual(['**/sites/**', '**/sites-public/**']);

  expect(
    existsSync(rootPath('scripts', 'validate-sites-public-url.mjs')),
    'PROJECT_CONTRACT:validate-sites-public-url.mjs must exist',
  ).toBe(true);
  expect(
    existsSync(rootPath('scripts', 'lib', 'sites-public-url.mjs')),
    'PROJECT_CONTRACT:scripts/lib/sites-public-url.mjs must exist',
  ).toBe(true);
  expect(
    existsSync(rootPath('scripts', 'lib', 'sites-public-url.d.mts')),
    'PROJECT_CONTRACT:scripts/lib/sites-public-url.d.mts must exist',
  ).toBe(true);
  expect(
    existsSync(rootPath('playwright.sites-public.config.ts')),
    'PROJECT_CONTRACT:playwright.sites-public.config.ts must exist',
  ).toBe(true);
  expect(
    existsSync(rootPath('tests', 'sites-public', 'public.spec.ts')),
    'PROJECT_CONTRACT:tests/sites-public/public.spec.ts must exist',
  ).toBe(true);

  const sitesAppPkgPath = rootPath('sites-app', 'package.json');
  expect(
    existsSync(sitesAppPkgPath),
    'PROJECT_CONTRACT:sites-app/package.json must exist',
  ).toBe(true);

  const sitesAppPackage = JSON.parse(
    readFileSync(sitesAppPkgPath, 'utf8'),
  ) as SitesAppPackageJson;
  expect(sitesAppPackage).toMatchObject({
    name: 'revenue-flow-guard-site',
    private: true,
    type: 'module',
    scripts: {
      build: 'node ../scripts/prepare-site-assets.mjs && vinext build',
      start: 'vinext start',
      check: 'vinext check',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      react: '19.2.7',
      'react-dom': '19.2.7',
      'react-server-dom-webpack': '19.2.7',
      vinext: '1.0.0-beta.2',
    },
    devDependencies: {
      vite: '8.1.5',
      '@vitejs/plugin-react': '6.0.3',
      '@vitejs/plugin-rsc': '0.5.28',
      '@types/react': '19.2.17',
      '@types/react-dom': '19.2.3',
    },
  });

  const nextEnvironmentTypes = readFileSync(
    rootPath('sites-app', 'next-env.d.ts'),
    'utf8',
  ).trim();
  expect(
    nextEnvironmentTypes.split(/\r?\n/)[0],
    'PROJECT_CONTRACT:next-env.d.ts must load vinext compatibility types',
  ).toBe('import "vinext/types";');

  for (const obsoletePath of [
    ['scripts', 'build-site.mjs'],
    ['scripts', 'build-site.d.mts'],
    ['sites', 'compatibility-worker.mjs'],
    ['wrangler.jsonc'],
  ]) {
    expect(
      existsSync(rootPath(...obsoletePath)),
      `PROJECT_CONTRACT:obsolete Sites path must be absent: ${obsoletePath.join('/')}`,
    ).toBe(false);
  }
});
