const barrierDeadlineMs = 5_000;

export type HeldBarrier = {
  reached: Promise<void>;
  release: () => void;
};

type ArmedBarrier = {
  markReached: () => void;
  waitForRelease: Promise<void>;
};

const withDeadline = (promise: Promise<void>, label: string): Promise<void> =>
  new Promise<void>((resolveDeadline, rejectDeadline) => {
    const timeout = setTimeout(
      () => rejectDeadline(new Error(`BARRIER:${label} exceeded 5 seconds`)),
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

export const createBarrierController = (label: string) => {
  let nextBarrier: ArmedBarrier | undefined;

  return {
    holdNext(): HeldBarrier {
      if (nextBarrier) {
        throw new Error(`BARRIER:${label} is already armed`);
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
        reached: withDeadline(reached, `${label} reach`),
        release,
      };
    },

    async waitAtBarrier(): Promise<void> {
      const barrier = nextBarrier;
      nextBarrier = undefined;

      if (!barrier) {
        return;
      }

      barrier.markReached();
      await withDeadline(barrier.waitForRelease, `${label} release`);
    },
  };
};
