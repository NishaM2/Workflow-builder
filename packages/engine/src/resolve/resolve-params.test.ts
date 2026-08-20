import { describe, expect, it } from 'vitest';
import { httpRequest, slackPost } from '@flow/core';
import type { ParameterValue } from '@flow/core';
import { resolveParams } from './resolve-params';

const outputs = new Map<string, unknown>([
    ['http_1', { status: 200, headers: {}, body: { title: 'Hello' } }],
    ['llm_1', { text: 'A summary.' }],
]);

describe('resolveParams', () => {
    it('passes literals through untouched', () => {
        const params: Record<string, ParameterValue> = {
            channel: { kind: 'literal', value: '#eng' },
            message: { kind: 'literal', value: 'hi' },
        };

        const result = resolveParams(slackPost, params, outputs);

        expect(result.ok && result.params).toEqual({
            channel: '#eng',
            message: 'hi',
        });
    });

    it('does not treat a literal containing {{...}} as a template', () => {
        const params: Record<string, ParameterValue> = {
            channel: { kind: 'literal', value: '#eng' },
            message: { kind: 'literal', value: 'use {{like.this}} syntax' },
        };

        const result = resolveParams(slackPost, params, outputs);

        expect(result.ok && (result.params as any).message).toBe(
            'use {{like.this}} syntax',
        );
    });

    it('resolves templates', () => {
        const params: Record<string, ParameterValue> = {
            channel: { kind: 'literal', value: '#eng' },
            message: { kind: 'template', template: '{{llm_1.text}}' },
        };

        const result = resolveParams(slackPost, params, outputs);

        expect(result.ok && (result.params as any).message).toBe('A summary.');
    });

    it('applies schema defaults', () => {
        const params: Record<string, ParameterValue> = {
            url: { kind: 'literal', value: 'https://example.com' },
            method: { kind: 'literal', value: 'GET' },
        };

        const result = resolveParams(httpRequest, params, outputs);

        expect(result.ok && (result.params as any).timeout).toBe(30000);
    });

    it('rejects an unresolved placeholder', () => {
        const params: Record<string, ParameterValue> = {
            channel: {
                kind: 'placeholder',
                placeholder: {
                    type: 'slack_channel',
                    prompt: 'Which channel?',
                    reason: 'not_specified',
                },
            },
            message: { kind: 'literal', value: 'hi' },
        };

        const result = resolveParams(slackPost, params, outputs);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.problems[0]?.param).toBe('channel');
    });

    it('catches a template that resolves to the wrong type', () => {
        const params: Record<string, ParameterValue> = {
            url: { kind: 'template', template: '{{http_1.status}}' },
            method: { kind: 'literal', value: 'GET' },
        };

        const result = resolveParams(httpRequest, params, outputs);

        expect(result.ok).toBe(false);
    });

    it('collects every problem in one pass', () => {
        const params: Record<string, ParameterValue> = {
            channel: { kind: 'template', template: '{{ghost_1.name}}' },
            message: { kind: 'template', template: '{{http_1.staus}}' },
        };

        const result = resolveParams(slackPost, params, outputs);

        expect(!result.ok && result.problems).toHaveLength(2);
    });
});