import { test as base } from '@playwright/test';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { validateExternalBaseUrl } from '../../scripts/lib/external-base-url.mjs';
import { createBarrierController, type HeldBarrier } from './barrier';

type ApplicationModule = {
  createApplication?: (options?: {
    clock?: () => number;
    orderBarrier?: { afterPending: () => Promise<void> };
    sessionBarrier?: { beforeResponse: () => Promise<void> };
    testMode?: boolean;
    testToken?: string;
    host?: string;
  }) => Server;
};

type IsolatedApp = {
  baseURL: string;
  externalMode: boolean;
  advanceTime: (milliseconds: number) => void;
  holdNextOrder: () => HeldBarrier;
  holdNextSessionResponse: () => HeldBarrier;
  waitForOrderResponse: () => Promise<void>;
  waitForSessionResponse: () => Promise<void>;
};

const missingFactoryError = 'ISOLATED_APP:createApplication is required';

const loadCreateApplication = (): ((options?: {
  clock?: () => number;
  orderBarrier?: { afterPending: () => Promise<void> };
  sessionBarrier?: { beforeResponse: () => Promise<void> };
  testMode?: boolean;
  testToken?: string;
  host?: string;
}) => Server) => {
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

const listen = async (server: Server, host = '127.0.0.1'): Promise<void> => {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, host, () => {
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

export type ApplicationOptions = {
  testMode?: boolean;
  testToken?: string;
  host?: string;
};

export const test = base.extend<{
  isolatedApp: IsolatedApp;
  applicationOptions: ApplicationOptions;
}>({
  applicationOptions: [{}, { option: true }],
  isolatedApp: async ({ applicationOptions }, use) => {
    const orderBarrier = createBarrierController('order barrier');
    const sessionResponseBarrier = createBarrierController(
      'session response barrier',
    );
    const externalBaseURL = process.env.RFG_EXTERNAL_BASE_URL;

    if (externalBaseURL !== undefined) {
      const validation = validateExternalBaseUrl(externalBaseURL);
      if (!validation.valid) {
        throw new Error('ISOLATED_APP:RFG_EXTERNAL_BASE_URL is invalid');
      }
      if (Object.keys(applicationOptions).length !== 0) {
        throw new Error(
          'ISOLATED_APP:applicationOptions are forbidden in external mode',
        );
      }

      await use({
        baseURL: validation.normalizedUrl,
        externalMode: true,
        advanceTime() {
          throw new Error(
            'ISOLATED_APP:advanceTime is unavailable in external mode',
          );
        },
        holdNextOrder: orderBarrier.holdNext,
        holdNextSessionResponse: sessionResponseBarrier.holdNext,
        waitForOrderResponse: orderBarrier.waitAtBarrier,
        waitForSessionResponse: sessionResponseBarrier.waitAtBarrier,
      });
      return;
    }

    const createApplication = loadCreateApplication();
    let now = 0;
    const server = createApplication({
      ...applicationOptions,
      clock: () => now,
      orderBarrier: {
        async afterPending() {
          await orderBarrier.waitAtBarrier();
        },
      },
      sessionBarrier: {
        async beforeResponse() {
          await sessionResponseBarrier.waitAtBarrier();
        },
      },
    });

    try {
      await listen(server, applicationOptions.host ?? '127.0.0.1');
      const address = server.address() as AddressInfo;

      await use({
        baseURL: `http://127.0.0.1:${address.port}`,
        externalMode: false,
        advanceTime(milliseconds) {
          now += milliseconds;
        },
        holdNextOrder() {
          return orderBarrier.holdNext();
        },
        holdNextSessionResponse() {
          return sessionResponseBarrier.holdNext();
        },
        waitForOrderResponse: orderBarrier.waitAtBarrier,
        waitForSessionResponse: sessionResponseBarrier.waitAtBarrier,
      });
    } finally {
      await close(server);
    }
  },
});

export { expect } from '@playwright/test';
