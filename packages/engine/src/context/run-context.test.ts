import { describe, expect, it } from 'vitest';
import type { Workflow } from '@flow/core';
import type { StepRecord } from '../types';
import { RunContext } from './run-context';

const node = (id: string, type: string) => ({
    id,
    type,
    typeVersion: 1,
    params: {},
    position: { x: 0, y: 0 },
});

const workflow: Workflow = {
    id: 'w1',
    name: 'branching',
    version: 1,
    nodes: [
        node('manual_1', 'manual.trigger'),
        node('if_1', 'logic.if'),
        node('slack_true', 'slack.post'),
        node('slack_false', 'slack.post'),
    ],
    edges: [
        { id: 'e1', from: 'manual_1', fromPort: 'main', to: 'if_1' },
        { id: 'e2', from: 'if_1', fromPort: 'true', to: 'slack_true' },
        { id: 'e3', from: 'if_1', fromPort: 'false', to: 'slack_false' },
    ],
};

const step = (
    nodeId: string,
    extra: Partial<StepRecord> = {},
): StepRecord => ({
    nodeId,
    state: 'success',
    firedPorts: ['main'],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.010Z',
    durationMs: 10,
    attempt: 1,
    ...extra,
});

describe('RunContext', () => {
    it('starts every edge pending', () => {
        const ctx = new RunContext(workflow);
        expect(ctx.getEdgeState('e1')).toBe('pending');
    });

    it('records output and activates the outgoing edge on success', () => {
        const ctx = new RunContext(workflow);
        ctx.recordSuccess(step('manual_1', { output: { hello: 'world' } }));

        expect(ctx.getOutput('manual_1')).toEqual({ hello: 'world' });
        expect(ctx.getEdgeState('e1')).toBe('active');
    });

    it('activates only the fired port and kills the other', () => {
        const ctx = new RunContext(workflow);
        ctx.recordSuccess(step('if_1', { output: {}, firedPorts: ['true'] }));

        expect(ctx.getEdgeState('e2')).toBe('active');
        expect(ctx.getEdgeState('e3')).toBe('dead');
    });

    it('kills outgoing edges when a node is skipped and records no output', () => {
        const ctx = new RunContext(workflow);
        ctx.recordSkipped(step('if_1', { state: 'skipped', firedPorts: [] }));

        expect(ctx.getOutputs().has('if_1')).toBe(false);
        expect(ctx.getEdgeState('e2')).toBe('dead');
        expect(ctx.getEdgeState('e3')).toBe('dead');
    });

    it('kills outgoing edges on error', () => {
        const ctx = new RunContext(workflow);
        ctx.recordError(
            step('if_1', {
                state: 'error',
                firedPorts: [],
                error: { message: 'boom' },
            }),
        );

        expect(ctx.getOutputs().has('if_1')).toBe(false);
        expect(ctx.getEdgeState('e2')).toBe('dead');
    });

    it('reports active incoming edges correctly', () => {
        const ctx = new RunContext(workflow);
        expect(ctx.hasIncomingEdges('manual_1')).toBe(false);
        expect(ctx.hasActiveIncomingEdge('slack_true')).toBe(false);

        ctx.recordSuccess(step('if_1', { output: {}, firedPorts: ['true'] }));

        expect(ctx.hasActiveIncomingEdge('slack_true')).toBe(true);
        expect(ctx.hasActiveIncomingEdge('slack_false')).toBe(false);
    });

    it('keeps the outputs/steps invariant', () => {
        const ctx = new RunContext(workflow);
        ctx.recordSuccess(step('manual_1', { output: {} }));
        ctx.recordSkipped(step('slack_true', { state: 'skipped', firedPorts: [] }));

        for (const s of ctx.getSteps()) {
            expect(ctx.getOutputs().has(s.nodeId)).toBe(s.state === 'success');
        }
    });
});