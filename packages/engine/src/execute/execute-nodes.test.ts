import { describe, expect, it } from 'vitest';
import type { ParameterValue, Workflow, WorkflowEdge } from '@flow/core';
import { RunContext } from '../context/run-context';
import { createFakeServices } from '../services/fake';
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

const run = async (
    workflow: Workflow,
    configure?: (fake: Fake) => void,
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
    });

    return { fake, context, outcome };
};

const stateOf = (context: RunContext, nodeId: string) =>
    context.getStep(nodeId)?.state;

const slackNode = (id: string, message: ParameterValue) =>
    node(id, 'slack.post', { channel: lit('#eng'), message });

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

        // Pending is not skipped: nothing was decided about this edge.
        expect(context.getEdgeState('e3')).toBe('pending');

        expect(fake.slackCalls).toHaveLength(0);
        expect(context.getSteps()).toHaveLength(4);
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
});
