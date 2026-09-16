import { describe, expect, it } from 'vitest';
import type { Placeholder, ParameterValue, Workflow } from '@flow/core';
import { collectBlockers, preflight } from './preflight';
import cycleFixture from '../../../core/src/fixtures/cycle.json';

const lit = (value: unknown): ParameterValue => ({ kind: 'literal', value });

const CHANNEL_PROMPT: Placeholder = {
    type: 'slack_channel',
    prompt: 'Which channel should this post to?',
    reason: 'not_specified',
    suggestions: ['#engineering', '#general'],
};

const ask = (placeholder: Placeholder): ParameterValue => ({
    kind: 'placeholder',
    placeholder,
});

const node = (
    id: string,
    type: string,
    params: Record<string, ParameterValue> = {},
) => ({ id, type, typeVersion: 1, params, position: { x: 0, y: 0 } });

const wf = (
    nodes: Workflow['nodes'],
    edges: Workflow['edges'] = [],
): Workflow => ({ id: 'w1', name: 'test', version: 1, nodes, edges });

// manual.trigger -> slack.post, with the channel left for a human to fill in.
const vague = (): Workflow =>
    wf(
        [
            node('manual_1', 'manual.trigger'),
            node('slack_1', 'slack.post', {
                channel: ask(CHANNEL_PROMPT),
                message: lit('Deploy finished'),
            }),
        ],
        [{ id: 'e1', from: 'manual_1', fromPort: 'main', to: 'slack_1' }],
    );

const complete = (): Workflow =>
    wf(
        [
            node('manual_1', 'manual.trigger'),
            node('slack_1', 'slack.post', {
                channel: lit('#engineering'),
                message: lit('Deploy finished'),
            }),
        ],
        [{ id: 'e1', from: 'manual_1', fromPort: 'main', to: 'slack_1' }],
    );

describe('collectBlockers', () => {
    it('finds nothing in a workflow with every parameter filled in', () => {
        expect(collectBlockers(complete())).toEqual([]);
    });

    it('carries the node, the parameter name and the whole placeholder', () => {
        expect(collectBlockers(vague())).toEqual([
            {
                nodeId: 'slack_1',
                param: 'channel',
                placeholder: CHANNEL_PROMPT,
            },
        ]);
    });

    // The prompt and the suggestions are the point: this is what a canvas field or
    // a CLI question is built from.
    it('keeps the placeholder intact, not a summary of it', () => {
        const [blocker] = collectBlockers(vague());

        expect(blocker?.placeholder.prompt).toBe(
            'Which channel should this post to?',
        );
        expect(blocker?.placeholder.suggestions).toEqual([
            '#engineering',
            '#general',
        ]);
    });

    it('reports every unfilled parameter, in node then parameter order', () => {
        const workflow = wf([
            node('manual_1', 'manual.trigger'),
            node('http_1', 'http.request', {
                url: ask({ type: 'url', prompt: 'Which URL?', reason: 'not_specified' }),
                method: lit('GET'),
            }),
            node('slack_1', 'slack.post', {
                channel: ask(CHANNEL_PROMPT),
                message: ask({
                    type: 'text',
                    prompt: 'What should it say?',
                    reason: 'not_specified',
                }),
            }),
        ]);

        expect(
            collectBlockers(workflow).map((b) => `${b.nodeId}.${b.param}`),
        ).toEqual(['http_1.url', 'slack_1.channel', 'slack_1.message']);
    });

    it('ignores literals and templates', () => {
        const workflow = wf([
            node('slack_1', 'slack.post', {
                channel: lit('#engineering'),
                message: { kind: 'template', template: '{{manual_1.id}}' },
            }),
        ]);

        expect(collectBlockers(workflow)).toEqual([]);
    });

    // It runs on half-built graphs, so it must not be the thing that throws.
    it('survives a malformed workflow rather than throwing', () => {
        const half = { id: 'w1', name: 'half' } as unknown as Workflow;

        expect(collectBlockers(half)).toEqual([]);
        expect(
            collectBlockers({ nodes: [{ id: 'n1' }] } as unknown as Workflow),
        ).toEqual([]);
    });
});

describe('preflight', () => {
    it('passes a valid, fully specified workflow', () => {
        expect(preflight(complete())).toEqual({
            ok: true,
            validationErrors: [],
            blockers: [],
        });
    });

    it('refuses a vague workflow on blockers alone', () => {
        const result = preflight(vague());

        expect(result.ok).toBe(false);
        expect(result.blockers).toHaveLength(1);
        // A placeholder is a warning to the validator, never an error.
        expect(result.validationErrors).toEqual([]);
    });

    it('refuses a broken graph on validation errors alone', () => {
        const orphan = wf([
            node('manual_1', 'manual.trigger'),
            node('slack_1', 'slack.post', {
                channel: lit('#engineering'),
                message: lit('hi'),
            }),
        ]);

        const result = preflight(orphan);

        expect(result.ok).toBe(false);
        expect(result.blockers).toEqual([]);
        expect(result.validationErrors.map((error) => error.code)).toContain(
            'UNREACHABLE_NODE',
        );
    });

    // The gate is what keeps a cycle from ever reaching the walk.
    it('refuses a cyclic graph', () => {
        const result = preflight(cycleFixture as unknown as Workflow);

        expect(result.ok).toBe(false);
        expect(result.validationErrors.map((error) => error.code)).toContain(
            'CYCLE_DETECTED',
        );
    });

    it('reports both kinds of problem at once', () => {
        const workflow = wf([
            node('manual_1', 'manual.trigger'),
            node('slack_1', 'slack.post', {
                channel: ask(CHANNEL_PROMPT),
                message: lit('hi'),
            }),
        ]);

        const result = preflight(workflow);

        expect(result.ok).toBe(false);
        expect(result.blockers).toHaveLength(1);
        expect(result.validationErrors.length).toBeGreaterThan(0);
    });

    it('does not refuse a run over warnings', () => {
        const result = preflight(complete());

        expect(result.ok).toBe(true);
    });
});
