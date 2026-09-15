import { httpRequest } from '@flow/core';
import type { NodeResult } from '@flow/core';

// One attempt at running a node, as the retry wrapper saw it.
export type AttemptOutcome =
    | { kind: 'returned'; result: NodeResult }
    | { kind: 'threw'; error: unknown };

// Retry only what would plausibly succeed if the same call were simply repeated.
// A validation failure, a blocked address or a bug fails identically every time,
// and retrying it spends seven seconds of backoff learning nothing. So anything
// not positively recognised as transient is not retried.

// Never retried, whatever else is true of the error. Listed by name so a network
// code attached to one of these can't sneak it into a retry.
const NEVER_RETRIED = new Set(['BlockedAddressError']);

// The HTTP node's own timeout, and the policy's outer timeout around the whole call.
const TIMEOUTS = new Set(['RequestTimeoutError', 'NodeTimeoutError']);

// Socket-level failures that tend to clear up on their own.
const TRANSIENT_NETWORK_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
]);

export function isRetryable(nodeType: string, outcome: AttemptOutcome): boolean {
    if (outcome.kind === 'threw') return isTransientError(outcome.error);

    const { result } = outcome;

    // A returned error is a verdict from dispatch or the executor: INVALID_OUTPUT,
    // INVALID_PORT, a bad trigger payload. The same call gets the same verdict.
    if (result.status === 'error') return false;

    // Non-2xx HTTP is a success carrying its status (Step 3), so a 503 arrives here
    // dressed as a success. Spotting it means knowing the HTTP node's output shape,
    // which is node-specific knowledge in a generic engine. Acceptable with one HTTP
    // node; the cleaner fix, letting an executor mark a success as retryable, is a
    // catalog change.
    if (nodeType === httpRequest.id) {
        return isRetryableStatus(statusOf(result.output));
    }

    return false;
}

// The delay before retry 1, 2 and 3: 1s, 2s, 4s.
export function backoffDelayMs(retry: number): number {
    return 1000 * 2 ** (retry - 1);
}

function isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (NEVER_RETRIED.has(error.name)) return false;
    if (TIMEOUTS.has(error.name)) return true;

    const code = networkCode(error);

    return code !== undefined && TRANSIENT_NETWORK_CODES.has(code);
}

// Node's fetch reports a socket failure as TypeError('fetch failed') with the real
// code on its cause; other clients put the code on the error itself.
function networkCode(error: Error): string | undefined {
    return codeOf(error) ?? codeOf(error.cause);
}

function codeOf(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null || !('code' in value)) {
        return undefined;
    }

    return typeof value.code === 'string' ? value.code : undefined;
}

function statusOf(output: unknown): number | undefined {
    if (typeof output !== 'object' || output === null || !('status' in output)) {
        return undefined;
    }

    return typeof output.status === 'number' ? output.status : undefined;
}

// 429 is the server asking for exactly this: try again later. Any other 4xx means
// the request itself is wrong, and it will be just as wrong next time.
function isRetryableStatus(status: number | undefined): boolean {
    if (status === undefined) return false;

    return status === 429 || (status >= 500 && status <= 599);
}
