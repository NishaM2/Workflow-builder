import type { Services } from '../types';

export const realClock: Services['clock'] = {
    now: () => new Date().toISOString(),

    nowMs: () => Date.now(),

    sleep: (ms: number) =>
        new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
        }),

    timer: (ms: number) => {
        let handle: ReturnType<typeof setTimeout> | undefined;

        const elapsed = new Promise<void>((resolve) => {
            handle = setTimeout(resolve, ms);
        });

        // A cancelled timer simply never resolves. Nothing awaits it once its race
        // is decided, so it is collected like any other unreachable promise.
        return { elapsed, cancel: () => clearTimeout(handle) };
    },
};
