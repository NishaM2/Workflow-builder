import { describe, expect, it } from 'vitest';
import type { Placeholder, ParameterValue, Workflow } from '@flow/core';
import { createFakeServices } from '../services/fake';
import { InMemoryRunStore } from '../store/in-memory-run-store';
import type { ExecutionPolicy, RunStatus, RunStore, StepRecord } from '../types';
import { executeWorkflow } from './execute-workflow';
import cycleFixture from '../../../core/src/fixtures/cycle.json';

type Fake = ReturnType<typeof createFakeServices>;

const lit = (value: unknown): ParameterValue => ({ kind: 'literal', value });

const CHANNEL_PROMPT: Placeholder = {
    type: 'slack_channel',
    prompt: 'Which channel should this post to?',
    reason: 'not_specified',
    suggestions: ['#engineering', '#general'],
};

const node = (
    id: string,
    type: string,
    params: Record<string, ParameterValue> = {},
) => ({ id, type, typeVersion: 1, params, position: { x: 0, y: 0 } });

const wf = (
    nodes: Workflow['nodes'],
    edges: Workflow['edges'] = [],
): Workflow => ({ id: 'w1', name: 'notify', version: 1, nodes, edges });

const POLICY: ExecutionPolicy = {
    onError: 'stop',
    retryCount: 0,
    timeoutMs: 30_000,
};

// manual.trigger -> slack.post. The channel is whatever the caller passes, which is
// the whole point: the same graph is vague or runnable depending on one parameter.
const notifyWorkflow = (channel: ParameterValue): Workflow =>
    wf(
        [
            node('manual_1', 'manual.trigger'),
            node('slack_1', 'slack.post', {
                channel,
                message: lit('Deploy finished'),
            }),
        ],
        [{ id: 'e1', from: 'manual_1', fromPort: 'main', to: 'slack_1' }],
    );

const vagueWorkflow = () =>
    notifyWorkflow({ kind: 'placeholder', placeholder: CHANNEL_PROMPT });

const filledWorkflow = () => notifyWorkflow(lit('#engineering'));

const httpNode = (id: string, url: string, onError?: 'stop' | 'continue') => ({
    ...node(id, 'http.request', { url: lit(url), method: lit('GET') }),
    ...(onError ? { onError } : {}),
});

// Watches the run row as it is written, so a status that only exists mid-run is
// still observable once the run is over.
function watchStore(inner: InMemoryRunStore) {
    const statusDuringSteps: (RunStatus | undefined)[] = [];
    const calls: string[] = [];

    const store: RunStore = {
        async startRun(input) {
            calls.push('startRun');
            await inner.startRun(input);
        },
        async recordStep(runId: string, step: StepRecord) {
            calls.push(`recordStep:${step.nodeId}`);
            statusDuringSteps.push(inner.getRun(runId)?.status);
            await inner.recordStep(runId, step);
        },
        async finishRun(input) {
            calls.push('finishRun');
            await inner.finishRun(input);
        },
    };

    return { store, calls, statusDuringSteps };
}

const run = async (
    workflow: Workflow,
    configure?: (fake: Fake) => void,
    policy: Partial<ExecutionPolicy> = {},
) => {
    const fake = createFakeServices();
    configure?.(fake);

    const inner = new InMemoryRunStore();
    const watched = watchStore(inner);

    const result = await executeWorkflow({
        workflow,
        triggerPayload: { source: 'test' },
        services: fake.services,
        store: watched.store,
        policy: { ...POLICY, ...policy },
    });

    return { result, fake, inner, ...watched };
};

describe('executeWorkflow: the gate', () => {
    it('refuses a vague workflow with the question that needs answering', async () => {
        const { result } = await run(vagueWorkflow());

        if (result.status !== 'blocked') throw new Error('expected blocked');

        expect(result.blockers).toEqual([
            {
                nodeId: 'slack_1',
                param: 'channel',
                placeholder: CHANNEL_PROMPT,
            },
        ]);
        expect(result.blockers[0]?.placeholder.prompt).toBe(
            'Which channel should this post to?',
        );
        expect(result.validationErrors).toEqual([]);
    });

    it('runs the same workflow once the channel is filled in', async () => {
        const { result, fake } = await run(filledWorkflow());

        expect(result.status).toBe('success');
        expect(fake.slackCalls).toEqual([
            { channel: '#engineering', message: 'Deploy finished' },
        ]);
    });

    it('does nothing at all when it refuses', async () => {
        const { result, fake, inner, calls } = await run(vagueWorkflow());

        expect(calls).toEqual([]);
        expect(inner.getRun(result.runId)).toBeUndefined();
        expect(fake.slackCalls).toEqual([]);
    });

    it('returns validation errors instead of throwing on a broken graph', async () => {
        const { result } = await run(cycleFixture as unknown as Workflow);

        if (result.status !== 'blocked') throw new Error('expected blocked');

        expect(result.validationErrors.map((error) => error.code)).toContain(
            'CYCLE_DETECTED',
        );
        expect(result.blockers).toEqual([]);
    });

    it('is blocked, not error, for an unknown node type', async () => {
        const workflow = wf([
            node('manual_1', 'manual.trigger'),
            node('mystery_1', 'not.a.real.node'),
        ]);

        const { result } = await run(workflow);

        if (result.status !== 'blocked') throw new Error('expected blocked');

        expect(result.validationErrors.map((error) => error.code)).toContain(
            'UNKNOWN_NODE_TYPE',
        );
    });

    // A blocked run never started, so there is nothing to report about it.
    it('carries no steps or timings when blocked', async () => {
        const { result } = await run(vagueWorkflow());

        expect(result).not.toHaveProperty('steps');
        expect(result).not.toHaveProperty('startedAt');
        expect(result).not.toHaveProperty('durationMs');
        expect(result.workflowId).toBe('w1');
        expect(result.runId).toMatch(/^run_/);
    });
});

describe('executeWorkflow: the verdict', () => {
    it('reports success with a step per node', async () => {
        const { result } = await run(filledWorkflow());

        if (result.status !== 'success') throw new Error('expected success');

        expect(result.steps.map((step) => [step.nodeId, step.state])).toEqual([
            ['manual_1', 'success'],
            ['slack_1', 'success'],
        ]);
    });

    it('reports the node that failed', async () => {
        const workflow = wf(
            [node('manual_1', 'manual.trigger'), httpNode('http_1', 'https://example.com')],
            [{ id: 'e1', from: 'manual_1', fromPort: 'main', to: 'http_1' }],
        );

        const { result } = await run(workflow, (fake) =>
            fake.queueHttpError(new Error('connection refused')),
        );

        if (result.status !== 'error') throw new Error('expected error');

        expect(result.failedNodeId).toBe('http_1');
        expect(result.error.message).toBe('connection refused');
    });

    // The decision in derive-status, reached through the real entry point: a branch
    // that kept running does not make the failure acceptable.
    it('is an error even when onError lets the walk continue', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                httpNode('http_1', 'https://example.com', 'continue'),
                node('slack_1', 'slack.post', {
                    channel: lit('#engineering'),
                    message: lit('independent branch'),
                }),
            ],
            [
                { id: 'e1', from: 'manual_1', fromPort: 'main', to: 'http_1' },
                { id: 'e2', from: 'manual_1', fromPort: 'main', to: 'slack_1' },
            ],
        );

        const { result, fake } = await run(workflow, (fake) =>
            fake.queueHttpError(new Error('connection refused')),
        );

        if (result.status !== 'error') throw new Error('expected error');

        expect(result.failedNodeId).toBe('http_1');
        // The independent branch still ran; the run is still a failure.
        expect(fake.slackCalls).toHaveLength(1);
        expect(
            result.steps.find((step) => step.nodeId === 'slack_1')?.state,
        ).toBe('success');
    });

    it('names the first failure when more than one node fails', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                httpNode('http_1', 'https://one.example.com', 'continue'),
                httpNode('http_2', 'https://two.example.com', 'continue'),
            ],
            [
                { id: 'e1', from: 'manual_1', fromPort: 'main', to: 'http_1' },
                { id: 'e2', from: 'manual_1', fromPort: 'main', to: 'http_2' },
            ],
        );

        const { result } = await run(workflow, (fake) => {
            fake.queueHttpError(new Error('first failure'));
            fake.queueHttpError(new Error('second failure'));
        });

        if (result.status !== 'error') throw new Error('expected error');

        expect(result.failedNodeId).toBe('http_1');
        expect(result.error.message).toBe('first failure');
    });
});

describe('executeWorkflow: the record', () => {
    it('opens a running row and closes it as terminal', async () => {
        const { result, inner, calls, statusDuringSteps } = await run(
            filledWorkflow(),
        );

        expect(calls).toEqual([
            'startRun',
            'recordStep:manual_1',
            'recordStep:slack_1',
            'finishRun',
        ]);
        // Every step was written while the row still said the run was in flight.
        expect(statusDuringSteps).toEqual(['running', 'running']);

        const stored = inner.getRun(result.runId);

        expect(stored?.status).toBe('success');
        expect(stored?.finishedAt).toBeTruthy();
    });

    it('closes the row as error when a node failed', async () => {
        const workflow = wf(
            [node('manual_1', 'manual.trigger'), httpNode('http_1', 'https://example.com')],
            [{ id: 'e1', from: 'manual_1', fromPort: 'main', to: 'http_1' }],
        );

        const { result, inner } = await run(workflow, (fake) =>
            fake.queueHttpError(new Error('boom')),
        );

        expect(inner.getRun(result.runId)?.status).toBe('error');
    });

    it('snapshots the graph and the trigger payload', async () => {
        const workflow = filledWorkflow();
        const { result, inner } = await run(workflow);

        const stored = inner.getRun(result.runId);

        expect(stored?.workflowId).toBe('w1');
        expect(stored?.workflowSnapshot).toEqual(workflow);
        expect(stored?.triggerPayload).toEqual({ source: 'test' });
    });

    it('stores the same steps it returns', async () => {
        const { result, inner } = await run(filledWorkflow());

        if (result.status !== 'success') throw new Error('expected success');

        expect(inner.getRun(result.runId)?.steps).toEqual(result.steps);
    });
});

describe('executeWorkflow: timings and identity', () => {
    it('gives every run its own id', async () => {
        const first = await run(filledWorkflow());
        const second = await run(filledWorkflow());

        expect(first.result.runId).not.toBe(second.result.runId);
    });

    it('reads the clock once at each end of the run', async () => {
        const { result } = await run(filledWorkflow());

        if (result.status !== 'success') throw new Error('expected success');

        // The fake clock is frozen unless something moves it, so a run that never
        // waits takes no time — and says so consistently in both places.
        expect(result.startedAt).toBe(result.finishedAt);
        expect(result.durationMs).toBe(0);
    });

    it('measures a run that actually took time', async () => {
        const workflow = wf(
            [node('manual_1', 'manual.trigger'), httpNode('http_1', 'https://slow.example.com')],
            [{ id: 'e1', from: 'manual_1', fromPort: 'main', to: 'http_1' }],
        );

        const { result } = await run(workflow, (fake) => fake.queueHttpHang(), {
            timeoutMs: 5_000,
        });

        if (result.status !== 'error') throw new Error('expected error');

        expect(result.durationMs).toBe(5_000);
        expect(Date.parse(result.finishedAt) - Date.parse(result.startedAt)).toBe(
            5_000,
        );
        expect(result.failedNodeId).toBe('http_1');
    });
});
