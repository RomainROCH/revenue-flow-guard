import { test as base } from '@playwright/test';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { Server } from 'node:http';

type ApplicationModule = {
  createApplication?: () => Server;
};

type IsolatedApp = {
  baseURL: string;
};

const missingFactoryError = 'ISOLATED_APP:createApplication is required';

const loadCreateApplication = (): (() => Server) => {
  const applicationPath = resolve(
    process.cwd(),
    'src',
    'create-application.js',
  );

  if (!existsSync(applicationPath)) {
    throw new Error(missingFactoryError);
  }

  const applicationModule = require(applicationPath) as ApplicationModule;

  if (typeof applicationModule.createApplication !== 'function') {
    throw new Error(missingFactoryError);
  }

  return applicationModule.createApplication;
};

const listen = async (server: Server): Promise<void> => {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
};

const close = async (server: Server): Promise<void> => {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }

      resolveClose();
    });
  });
};

export const test = base.extend<{ isolatedApp: IsolatedApp }>({
  isolatedApp: async ({}, use) => {
    const createApplication = loadCreateApplication();
    const server = createApplication();

    try {
      await listen(server);
      const address = server.address() as AddressInfo;

      await use({ baseURL: `http://127.0.0.1:${address.port}` });
    } finally {
      await close(server);
    }
  },
});

export { expect } from '@playwright/test';
