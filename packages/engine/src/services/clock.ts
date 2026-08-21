import type { Services } from '../types';

export const realClock: Services['clock'] = {
    now: () => new Date().toISOString(),

    nowMs: () => Date.now(),

    sleep: (ms: number) =>
        new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
        }),
};