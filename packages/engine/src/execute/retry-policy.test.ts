import { describe, expect, it } from 'vitest';
import type { NodeResult } from '@flow/core';
import { RequestTimeoutError } from '../services/http';
import { BlockedAddressError } from '../services/ssrf';
import { backoffDelayMs, isRetryable } from './retry-policy';
import type { AttemptOutcome } from './retry-policy';
import { NodeTimeoutError } from './with-retries';

const HTTP = 'http.request';
const SLACK = 'slack.post';

interface Case {
    label: string;
    nodeType: string;
    outcome: AttemptOutcome;
}

const row = (label: string, nodeType: string, outcome: AttemptOutcome): Case => ({
    label,
    nodeType,
    outcome,
});

const returned = (result: NodeResult): AttemptOutcome => ({ kind: 'returned', result });

const threw = (error: unknown): AttemptOutcome => ({ kind: 'threw', error });

const httpStatus = (status: number) =>
    returned({
        status: 'success',
        output: { status, headers: {}, body: {} },
        firedPorts: ['main'],
    });

const failedWith = (code: string) =>
    returned({ status: 'error', error: { message: code, code } });

// How Node's fetch reports a socket failure: the real code sits on the cause.
const socketFailure = (code: string) =>
    new TypeError('fetch failed', {
        cause: Object.assign(new Error(code), { code }),
    });

describe('isRetryable', () => {
    it.each([
        row('HTTP 429', HTTP, httpStatus(429)),
        row('HTTP 500', HTTP, httpStatus(500)),
        row('HTTP 503', HTTP, httpStatus(503)),
        row('HTTP 599', HTTP, httpStatus(599)),
        row('the HTTP node timing out', HTTP, threw(new RequestTimeoutError(30_000))),
        row('the policy timeout', SLACK, threw(new NodeTimeoutError(5000))),
        row('a reset connection', HTTP, threw(socketFailure('ECONNRESET'))),
        row('a refused connection', HTTP, threw(socketFailure('ECONNREFUSED'))),
        row('a temporary DNS failure', HTTP, threw(socketFailure('EAI_AGAIN'))),
    ])('retries $label', ({ nodeType, outcome }) => {
        expect(isRetryable(nodeType, outcome)).toBe(true);
    });

    it.each([
        row('HTTP 200', HTTP, httpStatus(200)),
        row('HTTP 400', HTTP, httpStatus(400)),
        row('HTTP 404', HTTP, httpStatus(404)),
        row('a 503-shaped output from a node that is not HTTP', SLACK, httpStatus(503)),
        row('a blocked address', HTTP, threw(new BlockedAddressError('private address'))),
        row(
            'a blocked address that carries a network code',
            HTTP,
            threw(
                Object.assign(new BlockedAddressError('Cannot resolve host'), {
                    code: 'EAI_AGAIN',
                }),
            ),
        ),
        row('an invalid output', HTTP, failedWith('INVALID_OUTPUT')),
        row('an unknown port', SLACK, failedWith('INVALID_PORT')),
        row('a parameter resolution failure', SLACK, failedWith('PARAM_RESOLUTION_FAILED')),
        row('a plain Error', SLACK, threw(new Error('boom'))),
        row('a thrown string', SLACK, threw('boom')),
    ])('does not retry $label', ({ nodeType, outcome }) => {
        expect(isRetryable(nodeType, outcome)).toBe(false);
    });
});

describe('backoffDelayMs', () => {
    it('doubles from one second', () => {
        expect([1, 2, 3].map((retry) => backoffDelayMs(retry))).toEqual([
            1000, 2000, 4000,
        ]);
    });
});
