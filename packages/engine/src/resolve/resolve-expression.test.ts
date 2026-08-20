import { describe, expect, it } from 'vitest';
import { resolveExpression } from './resolve-expression';

const outputs = new Map<string, unknown>([
    [
        'http_1',
        {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { title: 'Hello', items: [{ name: 'first' }] },
        },
    ],
    ['llm_1', { text: 'A summary.' }],
    ['odd_1', { value: 'costs $& more' }],
]);

describe('resolveExpression', () => {
    it('returns a raw string for a lone reference', () => {
        const result = resolveExpression('{{llm_1.text}}', outputs);
        expect(result).toEqual({ ok: true, value: 'A summary.' });
    });

    it('returns a raw number, not a string', () => {
        const result = resolveExpression('{{http_1.status}}', outputs);
        expect(result.ok && result.value).toBe(200);
    });

    it('returns a raw object for a lone reference', () => {
        const result = resolveExpression('{{http_1.body}}', outputs);
        expect(result.ok && result.value).toEqual({
            title: 'Hello',
            items: [{ name: 'first' }],
        });
    });

    it('interpolates an embedded reference', () => {
        const result = resolveExpression('Status: {{http_1.status}}!', outputs);
        expect(result.ok && result.value).toBe('Status: 200!');
    });

    it('interpolates multiple references', () => {
        const result = resolveExpression(
            '{{http_1.status}} — {{llm_1.text}}',
            outputs,
        );
        expect(result.ok && result.value).toBe('200 — A summary.');
    });

    it('stringifies an embedded object as JSON', () => {
        const result = resolveExpression('body={{http_1.body}}', outputs);
        expect(result.ok && result.value).toBe(
            'body={"title":"Hello","items":[{"name":"first"}]}',
        );
    });

    it('does not treat $& in a resolved value as a replacement pattern', () => {
        const result = resolveExpression('note: {{odd_1.value}}', outputs);
        expect(result.ok && result.value).toBe('note: costs $& more');
    });

    it('walks array indices', () => {
        const result = resolveExpression('{{http_1.body.items.0.name}}', outputs);
        expect(result.ok && result.value).toBe('first');
    });

    it('passes through a string with no references', () => {
        const result = resolveExpression('just text', outputs);
        expect(result.ok && result.value).toBe('just text');
    });

    it('errors on an unknown node', () => {
        const result = resolveExpression('{{ghost_1.text}}', outputs);
        expect(result.ok).toBe(false);
    });

    it('errors on a missing path segment, naming the segment', () => {
        const result = resolveExpression('{{http_1.staus}}', outputs);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.segment).toBe('staus');
    });

    it('does not resolve inherited properties', () => {
        const result = resolveExpression('{{http_1.constructor}}', outputs);
        expect(result.ok).toBe(false);
    });
});