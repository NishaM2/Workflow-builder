import type { Services } from '../types';

type HttpResponse = Awaited<ReturnType<Services['http']['request']>>;
type HttpOptions = Parameters<Services['http']['request']>[0];
type SlackOptions = Parameters<Services['slack']['post']>[0];
type LlmOptions = Parameters<Services['llm']['prompt']>[0];

type Queued<T> =
    | { kind: 'result'; value: T }
    | { kind: 'throw'; error: Error }
    | { kind: 'hang' };

interface PendingTimer {
    deadline: number;
    fire: () => void;
}

export function createFakeServices(startMs = 0) {
    const httpCalls: HttpOptions[] = [];
    const slackCalls: SlackOptions[] = [];
    const llmCalls: LlmOptions[] = [];
    const delays: number[] = [];

    const httpQueue: Queued<HttpResponse>[] = [];
    const timers = new Set<PendingTimer>();
    let currentMs = startMs;

    // Virtual time only moves when something moves it. Whenever it does, every
    // timer whose deadline has now passed fires.
    const moveTo = (ms: number) => {
        currentMs = ms;

        for (const timer of [...timers]) {
            if (timer.deadline <= currentMs) {
                timers.delete(timer);
                timer.fire();
            }
        }
    };

    // Jump to the earliest pending timer. To a timeout, this is exactly what a hung
    // call looks like: nothing happens until the deadline, and then the timer wins.
    const runToNextTimer = () => {
        if (timers.size === 0) {
            throw new Error('Fake call would hang forever: no timer is pending to end it');
        }

        moveTo(Math.min(...[...timers].map((timer) => timer.deadline)));
    };

    const services: Services = {
        http: {
            async request(options) {
                httpCalls.push(options);

                const next = httpQueue.shift();
                if (!next) return { status: 200, headers: {}, body: {} };
                if (next.kind === 'throw') throw next.error;

                if (next.kind === 'hang') {
                    runToNextTimer();
                    return new Promise<never>(() => {});
                }

                return next.value;
            },
        },

        llm: {
            async prompt(options) {
                llmCalls.push(options);
                return { text: 'fake response' };
            },
        },

        slack: {
            async post(options) {
                slackCalls.push(options);
                return { ok: true, ts: 'fake-ts' };
            },
        },

        logger: { info() {}, error() {} },

        clock: {
            now: () => new Date(currentMs).toISOString(),
            nowMs: () => currentMs,
            async sleep(ms: number) {
                delays.push(ms);
                moveTo(currentMs + ms);
            },
            timer(ms: number) {
                let pending!: PendingTimer;

                const elapsed = new Promise<void>((resolve) => {
                    pending = { deadline: currentMs + ms, fire: () => resolve() };
                });

                timers.add(pending);

                return {
                    elapsed,
                    cancel: () => {
                        timers.delete(pending);
                    },
                };
            },
        },
    };

    return {
        services,
        httpCalls,
        slackCalls,
        llmCalls,
        delays,

        // Queue the next HTTP response. Calls beyond the queue return a plain 200.
        queueHttp(response: HttpResponse) {
            httpQueue.push({ kind: 'result', value: response });
        },

        // Make the next HTTP call throw.
        queueHttpError(error: Error) {
            httpQueue.push({ kind: 'throw', error });
        },

        // Make the next HTTP call hang until the attempt's timeout ends it.
        queueHttpHang() {
            httpQueue.push({ kind: 'hang' });
        },

        // For a hand-written invocation that should hang the same way.
        runToNextTimer,

        // Timers still waiting. A finished attempt must leave none behind.
        pendingTimers: () => timers.size,

        // Advance the virtual clock without sleeping.
        advance(ms: number) {
            moveTo(currentMs + ms);
        },
    };
}
