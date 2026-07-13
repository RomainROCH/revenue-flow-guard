import { test as base } from '@playwright/test';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { Server } from 'node:http';

type ApplicationModule = {
  createApplication?: (options?: {
    clock?: () => number;
    orderBarrier?: { afterPending: () => Promise<void> };
  }) => Server;
};

type HeldOrder = {
  reached: Promise<void>;
  release: () => void;
};

type IsolatedApp = {
  baseURL: string;
  advanceTime: (milliseconds: number) => void;
  holdNextOrder: () => HeldOrder;
};

const missingFactoryError = 'ISOLATED_APP:createApplication is required';
const barrierDeadlineMs = 5_000;

const withDeadline = (promise: Promise<void>, label: string): Promise<void> =>
  new Promise<void>((resolveDeadline, rejectDeadline) => {
    const timeout = setTimeout(
      () => rejectDeadline(new Error(`ISOLATED_APP:${label} exceeded 5 seconds`)),
      barrierDeadlineMs,
    );

    promise.then(
      () => {
        clearTimeout(timeout);
        resolveDeadline();
      },
      (error) => {
        clearTimeout(timeout);
        rejectDeadline(error);
      },
    );
  });

const loadCreateApplication = (): ((options?: {
  clock?: () => number;
  orderBarrier?: { afterPending: () => Promise<void> };
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
    let now = 0;
    let nextBarrier:
      | {
          markReached: () => void;
          waitForRelease: Promise<void>;
        }
      | undefined;
    const server = createApplication({
      clock: () => now,
      orderBarrier: {
        async afterPending() {
          const barrier = nextBarrier;
          nextBarrier = undefined;

          if (!barrier) {
            return;
          }

          barrier.markReached();
          await withDeadline(barrier.waitForRelease, 'order barrier release');
        },
      },
    });

    try {
      await listen(server);
      const address = server.address() as AddressInfo;

      await use({
        baseURL: `http://127.0.0.1:${address.port}`,
        advanceTime(milliseconds) {
          now += milliseconds;
        },
        holdNextOrder() {
          if (nextBarrier) {
            throw new Error('ISOLATED_APP:an order barrier is already armed');
          }

          let markReached!: () => void;
          let release!: () => void;
          const reached = new Promise<void>((resolveReached) => {
            markReached = resolveReached;
          });
          const waitForRelease = new Promise<void>((resolveRelease) => {
            release = resolveRelease;
          });
          nextBarrier = { markReached, waitForRelease };

          return {
            reached: withDeadline(reached, 'order barrier reach'),
            release,
          };
        },
      });
    } finally {
      await close(server);
    }
  },
});

export { expect } from '@playwright/test';
