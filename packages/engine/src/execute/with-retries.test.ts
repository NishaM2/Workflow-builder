import { describe, expect, it } from 'vitest';
import type { NodeResult } from '@flow/core';
import { createFakeServices } from '../services/fake';
import { RequestTimeoutError } from '../services/http';
import { withRetries } from './with-retries';
import type { RetryOptions } from './with-retries';

type Fake = ReturnType<typeof createFakeServices>;

const ok: NodeResult = { status: 'success', output: {}, firedPorts: ['main'] };

const httpResponse = (status: number): NodeResult => ({
    status: 'success',
    output: { status, headers: {}, body: {} },
    firedPorts: ['main'],
});

// An invocation that plays back one scripted attempt per call, repeating the last
// one once the script runs out.
const script = (...attempts: Array<NodeResult | Error>) => {
    let calls = 0;

    const invoke = async (): Promise<NodeResult> => {
        const next = attempts[Math.min(calls, attempts.length - 1)]!;
        calls += 1;

        if (next instanceof Error) throw next;
        return next;
    };

    return { invoke, calls: () => calls };
};

const retry = (
    fake: Fake,
    invoke: () => Promise<NodeResult>,
    options: Partial<RetryOptions> = {},
) =>
    withRetries({
        nodeType: 'http.request',
        invoke,
        clock: fake.services.clock,
        retryCount: 3,
        timeoutMs: 30_000,
        ...options,
    });

describe('withRetries', () => {
    it('returns a first-time success without waiting', async () => {
        const fake = createFakeServices();
        const { invoke, calls } = script(ok);

        expect(await retry(fake, invoke)).toEqual({ result: ok, attempts: 1 });
        expect(calls()).toBe(1);
        expect(fake.delays).toEqual([]);
    });

    it('backs off 1s, 2s, 4s, then returns the last failure', async () => {
        const fake = createFakeServices();
        const { invoke, calls } = script(new RequestTimeoutError(30_000));

        const { result, attempts } = await retry(fake, invoke);

        expect(attempts).toBe(4);
        expect(calls()).toBe(4);
        expect(fake.delays).toEqual([1000, 2000, 4000]);
        expect(result).toEqual({
            status: 'error',
            error: {
                message: 'Request timed out after 30000ms',
                code: 'RequestTimeoutError',
            },
        });
    });

    it('stops as soon as an attempt succeeds', async () => {
        const fake = createFakeServices();
        const { invoke } = script(
            httpResponse(503),
            httpResponse(503),
            httpResponse(200),
        );

        const { result, attempts } = await retry(fake, invoke);

        expect(result).toEqual(httpResponse(200));
        expect(attempts).toBe(3);
        expect(fake.delays).toEqual([1000, 2000]);
        expect(fake.pendingTimers()).toBe(0);
    });

    it('hands back a status that is still failing as the success it is', async () => {
        const fake = createFakeServices();
        const { invoke } = script(httpResponse(503));

        const { result, attempts } = await retry(fake, invoke);

        expect(result).toEqual(httpResponse(503));
        expect(attempts).toBe(4);
    });

    it('does not retry what would fail the same way again', async () => {
        const fake = createFakeServices();
        const { invoke, calls } = script(new Error('a bug'));

        const { result, attempts } = await retry(fake, invoke);

        expect(attempts).toBe(1);
        expect(calls()).toBe(1);
        expect(fake.delays).toEqual([]);
        expect(result).toEqual({
            status: 'error',
            error: { message: 'a bug', code: 'Error' },
        });
    });

    it('makes a single attempt when retryCount is 0', async () => {
        const fake = createFakeServices();
        const { invoke, calls } = script(new RequestTimeoutError(30_000));

        const { attempts } = await retry(fake, invoke, { retryCount: 0 });

        expect(attempts).toBe(1);
        expect(calls()).toBe(1);
        expect(fake.delays).toEqual([]);
    });

    it('turns a synchronous throw into an error result', async () => {
        const fake = createFakeServices();
        const invoke = (): Promise<NodeResult> => {
            throw new Error('thrown before any await');
        };

        const { result } = await retry(fake, invoke);

        expect(result).toMatchObject({
            status: 'error',
            error: { message: 'thrown before any await' },
        });
    });

    it('times out a hung attempt and retries it', async () => {
        const fake = createFakeServices();
        let calls = 0;

        const invoke = (): Promise<NodeResult> => {
            calls += 1;
            if (calls > 1) return Promise.resolve(ok);

            fake.runToNextTimer();
            return new Promise<NodeResult>(() => {});
        };

        const { result, attempts } = await retry(fake, invoke, { timeoutMs: 5000 });

        expect(result).toEqual(ok);
        expect(attempts).toBe(2);
        expect(fake.delays).toEqual([1000]);

        // 5s waiting on the hung call, then 1s of backoff, all on the virtual clock.
        expect(fake.services.clock.nowMs()).toBe(6000);
        expect(fake.pendingTimers()).toBe(0);
    });

    it('arms a timer only when timeoutMs is positive', async () => {
        const fake = createFakeServices();
        let armed = -1;

        const invoke = async (): Promise<NodeResult> => {
            armed = fake.pendingTimers();
            return ok;
        };

        await retry(fake, invoke, { timeoutMs: 5000 });
        expect(armed).toBe(1);

        await retry(fake, invoke, { timeoutMs: 0 });
        expect(armed).toBe(0);
    });
});
