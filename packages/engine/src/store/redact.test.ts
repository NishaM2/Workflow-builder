import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@flow/core';
import type { StepRecord } from '../types';
import { REDACTED, redactStep, redactValue } from './redact';

const step = (extra: Partial<StepRecord> = {}): StepRecord => ({
    nodeId: 'http_1',
    state: 'success',
    firedPorts: ['main'],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.010Z',
    durationMs: 10,
    attempt: 1,
    ...extra,
});

describe('redactValue', () => {
    it('masks credential-named headers and keeps the rest', () => {
        expect(
            redactValue({
                method: 'GET',
                headers: {
                    Authorization: 'Bearer abc',
                    'X-Api-Key': 'k-123',
                    'x-auth-token': 't-123',
                    Cookie: 'session=1',
                    'Content-Type': 'application/json',
                },
            }),
        ).toEqual({
            method: 'GET',
            headers: {
                Authorization: REDACTED,
                'X-Api-Key': REDACTED,
                'x-auth-token': REDACTED,
                Cookie: REDACTED,
                'Content-Type': 'application/json',
            },
        });
    });

    it('reaches a header map wrapped in a snapshot ParameterValue', () => {
        expect(
            redactValue({
                headers: {
                    kind: 'literal',
                    value: { Authorization: 'Bearer abc', Accept: '*/*' },
                },
            }),
        ).toEqual({
            headers: {
                kind: 'literal',
                value: { Authorization: REDACTED, Accept: '*/*' },
            },
        });
    });

    it('masks response headers and query maps the same way', () => {
        expect(
            redactValue({
                status: 200,
                headers: { 'set-cookie': 'session=1', etag: 'abc' },
                query: { token: 't', page: '2' },
            }),
        ).toEqual({
            status: 200,
            headers: { 'set-cookie': REDACTED, etag: 'abc' },
            query: { token: REDACTED, page: '2' },
        });
    });

    it('masks credentials inside urls and leaves other urls exactly as they were', () => {
        const redacted = redactValue({
            url: 'https://user:pass@api.example.com/items?api_key=k&page=2',
            plain: { url: 'https://api.example.com/items?page=2' },
            template: { url: 'https://api.example.com/{{http_1.body.id}}' },
        });

        expect(redacted.url).toBe(
            'https://REDACTED:REDACTED@api.example.com/items?api_key=REDACTED&page=2',
        );
        expect(redacted.plain.url).toBe('https://api.example.com/items?page=2');
        expect(redacted.template.url).toBe('https://api.example.com/{{http_1.body.id}}');
    });

    it('never mutates its input', () => {
        const input = { headers: { Authorization: 'Bearer abc' } };

        redactValue(input);

        expect(input.headers.Authorization).toBe('Bearer abc');
    });
});

describe('redactStep', () => {
    it("masks an HTTP step's resolved headers", () => {
        const redacted = redactStep(
            step({
                resolvedParams: {
                    url: 'https://api.example.com',
                    method: 'GET',
                    headers: { Authorization: 'Bearer abc' },
                },
            }),
            undefined,
        );

        expect(redacted.resolvedParams).toEqual({
            url: 'https://api.example.com',
            method: 'GET',
            headers: { Authorization: REDACTED },
        });
    });

    it('masks a param the graph marks as an api_key placeholder, whatever it is called', () => {
        const node: WorkflowNode = {
            id: 'http_1',
            type: 'http.request',
            typeVersion: 1,
            position: { x: 0, y: 0 },
            params: {
                body: {
                    kind: 'placeholder',
                    placeholder: {
                        type: 'api_key',
                        prompt: 'Which key?',
                        reason: 'not_specified',
                    },
                },
                method: { kind: 'literal', value: 'POST' },
            },
        };

        const redacted = redactStep(
            step({ resolvedParams: { body: 'sk-live-123', method: 'POST' } }),
            node,
        );

        expect(redacted.resolvedParams).toEqual({ body: REDACTED, method: 'POST' });
    });

    it('leaves the step it was given untouched', () => {
        const original = step({
            resolvedParams: { headers: { Authorization: 'Bearer abc' } },
        });

        redactStep(original, undefined);

        expect(original.resolvedParams).toEqual({
            headers: { Authorization: 'Bearer abc' },
        });
    });
});
