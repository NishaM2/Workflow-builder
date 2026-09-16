import { describe, expect, it } from 'vitest';
import type { ParameterValue, Workflow, WorkflowEdge } from '@flow/core';
import { RunContext } from '../context/run-context';
import { createFakeServices } from '../services/fake';
import { InMemoryRunStore } from '../store/in-memory-run-store';
import type { ExecutionPolicy } from '../types';
import { executeNodes } from './execute-nodes';
import ifFixture from '../../../core/src/fixtures/valid-if.json';

type Fake = ReturnType<typeof createFakeServices>;

const lit = (value: unknown): ParameterValue => ({ kind: 'literal', value });

const tpl = (template: string): ParameterValue => ({
    kind: 'template',
    template,
});

const node = (
    id: string,
    type: string,
    params: Record<string, ParameterValue> = {},
) => ({
    id,
    type,
    typeVersion: 1,
    params,
    position: { x: 0, y: 0 },
});

const edge = (
    id: string,
    from: string,
    fromPort: string,
    to: string,
): WorkflowEdge => ({ id, from, fromPort, to });

const wf = (
    nodes: Workflow['nodes'],
    edges: Workflow['edges'],
): Workflow => ({ id: 'w1', name: 'test', version: 1, nodes, edges });

// The fixture is shared with Step 8's CLI demo, so tests copy it rather than
// mutating the imported object.
const branchingFixture = (): Workflow =>
    JSON.parse(JSON.stringify(ifFixture)) as Workflow;

// Realistic defaults, so every loop test also runs through the retry wrapper and
// arms, then cancels, a timer for each node it executes.
const POLICY: ExecutionPolicy = {
    onError: 'stop',
    retryCount: 3,
    timeoutMs: 30_000,
};

const run = async (
    workflow: Workflow,
    configure?: (fake: Fake) => void,
    policy: Partial<ExecutionPolicy> = {},
) => {
    const fake = createFakeServices();
    configure?.(fake);

    const context = new RunContext(workflow);

    const outcome = await executeNodes({
        workflow,
        context,
        services: fake.services,
        runId: 'run_1',
        triggerPayload: {},
        policy: { ...POLICY, ...policy },
    });

    return { fake, context, outcome };
};

const stateOf = (context: RunContext, nodeId: string) =>
    context.getStep(nodeId)?.state;

const slackNode = (id: string, message: ParameterValue) =>
    node(id, 'slack.post', { channel: lit('#eng'), message });

const httpNode = (id: string) =>
    node(id, 'http.request', {
        url: lit('https://example.com'),
        method: lit('GET'),
    });

describe('executeNodes', () => {
    it('takes the false branch and calls slack exactly once', async () => {
        const workflow = branchingFixture();
        const ifNode = workflow.nodes.find((n) => n.id === 'if_1')!;
        ifNode.params.left = lit('1'); // 1 > 5 is false

        const { fake, context, outcome } = await run(workflow);

        expect(outcome).toEqual({ completed: true });
        expect(stateOf(context, 'slack_false')).toBe('success');
        expect(stateOf(context, 'slack_true')).toBe('skipped');

        // The status is a claim; the call log is the evidence. A bug that marks
        // the node skipped and posts anyway only shows up here.
        expect(fake.slackCalls).toHaveLength(1);
        expect(fake.slackCalls[0]?.message).toBe('Condition is false');

        // No holes: every node in the graph has a record.
        expect(context.getSteps()).toHaveLength(workflow.nodes.length);
    });

    it('takes the true branch when the condition holds', async () => {
        const { fake, context } = await run(branchingFixture());

        expect(stateOf(context, 'slack_true')).toBe('success');
        expect(stateOf(context, 'slack_false')).toBe('skipped');
        expect(fake.slackCalls).toHaveLength(1);
        expect(fake.slackCalls[0]?.message).toBe('Condition is true');
    });

    it('lets fired ports drive the edges, not node order', async () => {
        const { context } = await run(branchingFixture());

        expect(context.getEdgeState('edge_2')).toBe('active'); // true
        expect(context.getEdgeState('edge_3')).toBe('dead'); // false
    });

    it('runs a linear workflow in order and flows outputs through templates', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                node('http_1', 'http.request', {
                    url: lit('https://example.com'),
                    method: lit('GET'),
                }),
                node('llm_1', 'llm.prompt', {
                    prompt: tpl('Summarize {{http_1.body.title}}'),
                    model: lit('claude-opus-5'),
                }),
                slackNode('slack_1', tpl('{{llm_1.text}}')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'http_1'),
                edge('e2', 'http_1', 'main', 'llm_1'),
                edge('e3', 'llm_1', 'main', 'slack_1'),
            ],
        );

        const { fake, context, outcome } = await run(workflow, (f) =>
            f.queueHttp({
                status: 200,
                headers: {},
                body: { title: 'Hello' },
            }),
        );

        expect(outcome).toEqual({ completed: true });

        expect(context.getSteps().map((step) => step.nodeId)).toEqual([
            'manual_1',
            'http_1',
            'llm_1',
            'slack_1',
        ]);

        for (const step of context.getSteps()) {
            expect(step.state).toBe('success');
        }

        // Data crossed two hops: http -> llm -> slack.
        expect(fake.llmCalls[0]?.prompt).toBe('Summarize Hello');
        expect(fake.slackCalls[0]?.message).toBe('fake response');
    });

    it('propagates a skip all the way down the untaken branch', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                node('if_1', 'logic.if', {
                    left: lit('1'),
                    operator: lit('greater_than'),
                    right: lit('5'),
                }),
                slackNode('slack_true', lit('true branch')),
                node('llm_after', 'llm.prompt', {
                    prompt: lit('never runs'),
                    model: lit('claude-opus-5'),
                }),
                slackNode('slack_false', lit('false branch')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'if_1'),
                edge('e2', 'if_1', 'true', 'slack_true'),
                edge('e3', 'slack_true', 'main', 'llm_after'),
                edge('e4', 'if_1', 'false', 'slack_false'),
            ],
        );

        const { fake, context } = await run(workflow);

        // Both nodes on the untaken branch, not just the first.
        expect(stateOf(context, 'slack_true')).toBe('skipped');
        expect(stateOf(context, 'llm_after')).toBe('skipped');
        expect(stateOf(context, 'slack_false')).toBe('success');

        expect(fake.slackCalls).toHaveLength(1);
        expect(fake.llmCalls).toHaveLength(0);
    });

    it('fails a node whose template references a skipped node', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                node('if_1', 'logic.if', {
                    left: lit('1'),
                    operator: lit('greater_than'),
                    right: lit('5'),
                }),
                slackNode('slack_true', lit('true branch')),
                slackNode('slack_false', lit('false branch')),
                // Sits on the taken path but reaches for the untaken one.
                slackNode('final', tpl('{{slack_true.ts}}')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'if_1'),
                edge('e2', 'if_1', 'true', 'slack_true'),
                edge('e3', 'if_1', 'false', 'slack_false'),
                edge('e4', 'slack_false', 'main', 'final'),
            ],
        );

        const { fake, context, outcome } = await run(workflow);

        expect(outcome).toMatchObject({
            completed: false,
            haltedAt: 'final',
        });

        const step = context.getStep('final');
        expect(step?.state).toBe('error');
        expect(step?.error?.code).toBe('PARAM_RESOLUTION_FAILED');

        // Resolution is what failed, so there are no resolved params to show.
        expect(step?.resolvedParams).toBeUndefined();

        expect(fake.slackCalls).toHaveLength(1);
    });

    it('marks nodes after a failure pending, not skipped', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                node('http_1', 'http.request', {
                    url: lit('https://example.com'),
                    method: lit('GET'),
                }),
                slackNode('slack_1', lit('never sent')),
                node('llm_1', 'llm.prompt', {
                    prompt: lit('never runs'),
                    model: lit('claude-opus-5'),
                }),
            ],
            [
                edge('e1', 'manual_1', 'main', 'http_1'),
                edge('e2', 'http_1', 'main', 'slack_1'),
                edge('e3', 'slack_1', 'main', 'llm_1'),
            ],
        );

        const { fake, context, outcome } = await run(workflow, (f) =>
            f.queueHttpError(new Error('network down')),
        );

        expect(outcome).toMatchObject({
            completed: false,
            haltedAt: 'http_1',
        });

        expect(stateOf(context, 'manual_1')).toBe('success');
        expect(stateOf(context, 'http_1')).toBe('error');
        expect(stateOf(context, 'slack_1')).toBe('pending');
        expect(stateOf(context, 'llm_1')).toBe('pending');

        // Only a node that reached dispatch has made an attempt.
        expect(context.getStep('http_1')?.attempt).toBe(1);
        expect(context.getStep('slack_1')?.attempt).toBe(0);

        // Pending is not skipped: nothing was decided about this edge.
        expect(context.getEdgeState('e3')).toBe('pending');

        expect(fake.slackCalls).toHaveLength(0);
        expect(context.getSteps()).toHaveLength(4);
    });

    it('classifies nodes the same whichever order the walk visits them in', async () => {
        // Condition false, so the false-branch Slack node runs and its call
        // fails, halting the run.
        const halting = (workflow: Workflow): Workflow => {
            workflow.nodes.find((n) => n.id === 'if_1')!.params.left = lit('1');
            return workflow;
        };

        const slackDown = (fake: Fake) => {
            fake.services.slack.post = async () => {
                throw new Error('slack down');
            };
        };

        const forward = halting(branchingFixture());

        // topoSort breaks ties by edge order, so the edges have to move too.
        // Reversing only the nodes array leaves the walk order unchanged.
        const reversed = halting(branchingFixture());
        reversed.nodes.reverse();
        reversed.edges.reverse();

        const forwardRun = await run(forward, slackDown);
        const reversedRun = await run(reversed, slackDown);

        const visitOrder = (context: RunContext) =>
            context.getSteps().map((step) => step.nodeId);

        const states = (context: RunContext) =>
            Object.fromEntries(
                context.getSteps().map((step) => [step.nodeId, step.state]),
            );

        // Guard against a vacuous pass: the runs must really visit the two
        // Slack nodes in opposite orders.
        expect(visitOrder(reversedRun.context)).not.toEqual(
            visitOrder(forwardRun.context),
        );

        // slack_true's branch was decided against before the halt, so it is
        // skipped in both runs, never pending just because it sorted later.
        expect(states(reversedRun.context)).toEqual(states(forwardRun.context));
        expect(stateOf(reversedRun.context, 'slack_true')).toBe('skipped');
        expect(stateOf(reversedRun.context, 'slack_false')).toBe('error');
        expect(reversedRun.outcome).toEqual(forwardRun.outcome);
    });

    it('returns a cycle as an outcome instead of throwing', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                slackNode('slack_a', lit('a')),
                slackNode('slack_b', lit('b')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'slack_a'),
                edge('e2', 'slack_a', 'main', 'slack_b'),
                edge('e3', 'slack_b', 'main', 'slack_a'),
            ],
        );

        const { fake, context, outcome } = await run(workflow);

        expect(outcome).toMatchObject({
            completed: false,
            haltedAt: null,
            error: { code: 'CYCLE_DETECTED' },
        });

        // Nothing was reached, but every node still has a record.
        expect(context.getSteps()).toHaveLength(workflow.nodes.length);

        for (const step of context.getSteps()) {
            expect(step.state).toBe('pending');
        }

        expect(fake.slackCalls).toHaveLength(0);
    });

    it('runs a rejoining node once, against the branch that was taken', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                node('if_1', 'logic.if', {
                    left: lit('1'),
                    operator: lit('greater_than'),
                    right: lit('5'),
                }),
                slackNode('slack_true', lit('true branch')),
                slackNode('slack_false', lit('false branch')),
                slackNode('final', tpl('{{slack_false.ts}}')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'if_1'),
                edge('e2', 'if_1', 'true', 'slack_true'),
                edge('e3', 'if_1', 'false', 'slack_false'),
                edge('e4', 'slack_true', 'main', 'final'),
                edge('e5', 'slack_false', 'main', 'final'),
            ],
        );

        const { fake, context, outcome } = await run(workflow);

        expect(outcome).toEqual({ completed: true });
        expect(stateOf(context, 'slack_true')).toBe('skipped');
        expect(stateOf(context, 'final')).toBe('success');

        // One active input and one dead one still runs the node exactly once —
        // two slack calls total, the false branch and the rejoin.
        expect(fake.slackCalls).toHaveLength(2);
        expect(fake.slackCalls[1]?.message).toBe('fake-ts');

        expect(context.getEdgeState('e4')).toBe('dead');
        expect(context.getEdgeState('e5')).toBe('active');
    });

    it('retries a failing HTTP call and records how many attempts it took', async () => {
        const workflow = wf(
            [node('manual_1', 'manual.trigger'), httpNode('http_1')],
            [edge('e1', 'manual_1', 'main', 'http_1')],
        );

        const { fake, context, outcome } = await run(workflow, (f) => {
            f.queueHttp({ status: 503, headers: {}, body: {} });
            f.queueHttp({ status: 503, headers: {}, body: {} });
            f.queueHttp({ status: 200, headers: {}, body: { ok: true } });
        });

        expect(outcome).toEqual({ completed: true });
        expect(fake.httpCalls).toHaveLength(3);
        expect(fake.delays).toEqual([1000, 2000]);

        const step = context.getStep('http_1');
        expect(step?.state).toBe('success');
        expect(step?.attempt).toBe(3);
        expect(step?.output).toMatchObject({ status: 200 });

        // The backoff is part of how long the node took, on the virtual clock.
        expect(step?.durationMs).toBe(3000);
    });

    it('times out a hung call on every attempt, then fails the node', async () => {
        const workflow = wf(
            [node('manual_1', 'manual.trigger'), httpNode('http_1')],
            [edge('e1', 'manual_1', 'main', 'http_1')],
        );

        const { fake, context, outcome } = await run(
            workflow,
            (f) => {
                for (let i = 0; i < 4; i += 1) f.queueHttpHang();
            },
            { timeoutMs: 5000 },
        );

        expect(outcome).toMatchObject({
            completed: false,
            haltedAt: 'http_1',
            error: { code: 'NodeTimeoutError' },
        });

        const step = context.getStep('http_1');
        expect(step?.attempt).toBe(4);
        expect(fake.delays).toEqual([1000, 2000, 4000]);

        // Four 5s timeouts plus 7s of backoff, and not one real millisecond.
        expect(step?.durationMs).toBe(27_000);
        expect(fake.pendingTimers()).toBe(0);
    });

    it('continues past a failure, skipping only what depended on it', async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                httpNode('http_1'),
                slackNode('after_http', lit('depends on http')),
                slackNode('independent', lit('runs regardless')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'http_1'),
                edge('e2', 'http_1', 'main', 'after_http'),
                edge('e3', 'manual_1', 'main', 'independent'),
            ],
        );

        const { fake, context, outcome } = await run(
            workflow,
            (f) => f.queueHttpError(new Error('network down')),
            { onError: 'continue' },
        );

        // 'continue' means only that the walk doesn't halt.
        expect(outcome).toEqual({ completed: true });
        expect(stateOf(context, 'http_1')).toBe('error');

        // The failed node's edges still die, so what depended on it is skipped
        // rather than run against an output that doesn't exist...
        expect(context.getEdgeState('e2')).toBe('dead');
        expect(stateOf(context, 'after_http')).toBe('skipped');

        // ...while the independent branch runs.
        expect(stateOf(context, 'independent')).toBe('success');
        expect(fake.slackCalls).toEqual([
            { channel: '#eng', message: 'runs regardless' },
        ]);
    });

    it("lets a node's onError override the run's", async () => {
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                { ...httpNode('http_1'), onError: 'stop' as const },
                slackNode('independent', lit('never reached')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'http_1'),
                edge('e2', 'manual_1', 'main', 'independent'),
            ],
        );

        const { fake, context, outcome } = await run(
            workflow,
            (f) => f.queueHttpError(new Error('network down')),
            { onError: 'continue' },
        );

        // The run says continue; http_1 says stop, and http_1 wins.
        expect(outcome).toMatchObject({ completed: false, haltedAt: 'http_1' });
        expect(stateOf(context, 'independent')).toBe('pending');
        expect(fake.slackCalls).toHaveLength(0);
    });

    it('fails a node whose template references a node that errored', async () => {
        // Only reachable now. Under 'continue' a node can still run after a node it
        // references has failed: final runs off slack_1's edge, but reads http_1.
        const workflow = wf(
            [
                node('manual_1', 'manual.trigger'),
                { ...httpNode('http_1'), onError: 'continue' as const },
                slackNode('slack_1', lit('independent')),
                slackNode('final', tpl('{{http_1.status}}')),
            ],
            [
                edge('e1', 'manual_1', 'main', 'http_1'),
                edge('e2', 'manual_1', 'main', 'slack_1'),
                edge('e3', 'http_1', 'main', 'final'),
                edge('e4', 'slack_1', 'main', 'final'),
            ],
        );

        const { context, outcome } = await run(workflow, (f) =>
            f.queueHttpError(new Error('network down')),
        );

        const step = context.getStep('final');
        expect(step?.state).toBe('error');
        expect(step?.error?.code).toBe('PARAM_RESOLUTION_FAILED');
        expect(step?.resolvedParams).toBeUndefined();
        expect(step?.attempt).toBe(0);

        // final inherits the run's 'stop', so its own failure halts the walk.
        expect(outcome).toMatchObject({ completed: false, haltedAt: 'final' });
    });

    it('hands each step to onStep as it is recorded, in walk order', async () => {
        const workflow = branchingFixture();
        const fake = createFakeServices();
        const context = new RunContext(workflow);
        const store = new InMemoryRunStore();

        await store.startRun({
            runId: 'run_1',
            workflowId: workflow.id,
            workflowSnapshot: workflow,
            triggerPayload: {},
            startedAt: fake.services.clock.now(),
        });

        const announced: string[] = [];

        await executeNodes({
            workflow,
            context,
            services: fake.services,
            runId: 'run_1',
            triggerPayload: {},
            policy: POLICY,
            onStep: async (step) => {
                announced.push(step.nodeId);
                await store.recordStep('run_1', step);
            },
        });

        expect(announced).toEqual(context.getSteps().map((step) => step.nodeId));

        // The in-memory store holds real values, exactly as the context recorded them.
        expect(store.getRun('run_1')?.steps).toEqual(context.getSteps());
    });

    it('keeps running when a step listener fails', async () => {
        const workflow = branchingFixture();
        const fake = createFakeServices();
        const context = new RunContext(workflow);
        const logged: string[] = [];

        fake.services.logger.error = (message) => {
            logged.push(message);
        };

        const outcome = await executeNodes({
            workflow,
            context,
            services: fake.services,
            runId: 'run_1',
            triggerPayload: {},
            policy: POLICY,
            onStep: () => {
                throw new Error('listener down');
            },
        });

        expect(outcome).toEqual({ completed: true });
        expect(context.getSteps()).toHaveLength(workflow.nodes.length);
        expect(logged).toHaveLength(workflow.nodes.length);
    });
});
