import type { NodeResult } from '@flow/core';
import type { Services } from '../types';
import { backoffDelayMs, isRetryable } from './retry-policy';
import type { AttemptOutcome } from './retry-policy';

// Thrown when an attempt outlives policy.timeoutMs.
export class NodeTimeoutError extends Error {
    constructor(ms: number) {
        super(`Node timed out after ${ms}ms`);
        this.name = 'NodeTimeoutError';
    }
}

export interface RetryOptions {
    nodeType: string;
    // A single executor call. It is invoked afresh for every attempt.
    invoke: () => Promise<NodeResult>;
    clock: Services['clock'];
    retryCount: number;
    // 0 disables the outer timeout.
    timeoutMs: number;
}

export interface RetriedResult {
    result: NodeResult;
    attempts: number;
}

// Runs an executor invocation with retries, backoff and the policy timeout, and
// always resolves: whatever an attempt throws becomes an error result, so nothing
// escapes into the walk. retryCount counts retries after the first attempt, so 3
// means up to four calls, with 1s, 2s and 4s between them.
export async function withRetries({
    nodeType,
    invoke,
    clock,
    retryCount,
    timeoutMs,
}: RetryOptions): Promise<RetriedResult> {
    for (let attempts = 1; ; attempts += 1) {
        const outcome = await attempt(invoke, clock, timeoutMs);
        const retriesLeft = attempts <= retryCount;

        if (!retriesLeft || !isRetryable(nodeType, outcome)) {
            return { result: toNodeResult(outcome), attempts };
        }

        await clock.sleep(backoffDelayMs(attempts));
    }
}

// The policy timeout races the whole executor call, redirects and body reading
// included, while the HTTP node's own `timeout` param bounds only the network
// exchange inside it. Neither overrides the other: they are independent caps, so
// whichever is shorter fires first, and the error's name records which it was.
// Both are retried.
//
// Racing abandons the losing call rather than cancelling it, so a timed-out request
// carries on in the background and a retry can overlap it. Cancelling it for real
// means threading an AbortSignal through ExecutorArgs into the services.
async function attempt(
    invoke: () => Promise<NodeResult>,
    clock: Services['clock'],
    timeoutMs: number,
): Promise<AttemptOutcome> {
    if (!(timeoutMs > 0 && Number.isFinite(timeoutMs))) {
        try {
            return { kind: 'returned', result: await invoke() };
        } catch (error) {
            return { kind: 'threw', error };
        }
    }

    // Arm the timer before starting the call, so the deadline covers everything the
    // call does, including the synchronous part before its first await.
    const timer = clock.timer(timeoutMs);

    try {
        const result = await Promise.race([
            invoke(),
            timer.elapsed.then((): never => {
                throw new NodeTimeoutError(timeoutMs);
            }),
        ]);

        return { kind: 'returned', result };
    } catch (error) {
        return { kind: 'threw', error };
    } finally {
        timer.cancel();
    }
}

// The code is the error's class name on purpose: it keeps RequestTimeoutError,
// BlockedAddressError and NodeTimeoutError distinct in the trace, so a step shows
// exactly what the classifier saw. Anything generic reads 'Error'.
function toNodeResult(outcome: AttemptOutcome): NodeResult {
    if (outcome.kind === 'returned') return outcome.result;

    const { error } = outcome;

    return {
        status: 'error',
        error: {
            message: error instanceof Error ? error.message : String(error),
            code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        },
    };
}
