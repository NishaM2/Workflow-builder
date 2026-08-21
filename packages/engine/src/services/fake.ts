import type { Services } from '../types';

type HttpResponse = Awaited<ReturnType<Services['http']['request']>>;
type HttpOptions = Parameters<Services['http']['request']>[0];
type SlackOptions = Parameters<Services['slack']['post']>[0];
type LlmOptions = Parameters<Services['llm']['prompt']>[0];

type Queued<T> = { kind: 'result'; value: T } | { kind: 'throw'; error: Error };

export function createFakeServices(startMs = 0) {
    const httpCalls: HttpOptions[] = [];
    const slackCalls: SlackOptions[] = [];
    const llmCalls: LlmOptions[] = [];
    const delays: number[] = [];

    const httpQueue: Queued<HttpResponse>[] = [];
    let currentMs = startMs;

    const services: Services = {
        http: {
            async request(options) {
                httpCalls.push(options);

                const next = httpQueue.shift();
                if (!next) return { status: 200, headers: {}, body: {} };
                if (next.kind === 'throw') throw next.error;
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
                currentMs += ms;
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

        // Make the next HTTP call throw — for testing retries. 
        queueHttpError(error: Error) {
            httpQueue.push({ kind: 'throw', error });
        },

        // Advance the virtual clock without sleeping. 
        advance(ms: number) {
        currentMs += ms;
        },
    };
}