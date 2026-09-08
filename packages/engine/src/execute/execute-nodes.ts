import { getNodeDefinition, topoSort } from '@flow/core';
import type { NodeResult, Workflow } from '@flow/core';
import { RunContext } from '../context/run-context';
import { dispatch } from '../executors/dispatch';
import { resolveParams } from '../resolve/resolve-params';
import type { NodeState, Services, StepRecord } from '../types';


export interface ExecuteNodesArgs {
    workflow: Workflow;
    context: RunContext;
    services: Services;
    runId: string;
    triggerPayload: unknown;
}

export type ExecuteNodesOutcome =
    | { completed: true }
    | {
        completed: false;
        haltedAt: string;
        error: { message: string; code?: string };
    };

type Halt = Extract<ExecuteNodesOutcome, { completed: false }>;

interface StepInput {
    nodeId: string;
    state: NodeState;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    firedPorts?: string[];
    resolvedParams?: Record<string, unknown>;
    output?: unknown;
    error?: { message: string; code?: string };
}

// One place to build a step record, so Step 5 varies `attempt` here rather than
// in four separate object literals.
function makeStep(input: StepInput): StepRecord {
    return {
        nodeId: input.nodeId,
        state: input.state,
        firedPorts: input.firedPorts ?? [],
        resolvedParams: input.resolvedParams,
        output: input.output,
        error: input.error,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
        attempt: 1,
    };
}

// A node runs because something reached it, never because of what it is. There
// is deliberately no catalog lookup here — the trigger runs because nothing
// feeds it, which is the same rule every other node follows.
function shouldRun(context: RunContext, nodeId: string): boolean {
    if (!context.hasIncomingEdges(nodeId)) return true;

    return context.hasActiveIncomingEdge(nodeId);
}

// In a topologically-ordered walk every upstream node has already been
// recorded, so every incoming edge is settled by the time we arrive. A pending
// one means the ordering is wrong — surface it rather than handling it.
function assertInputsSettled(
    context: RunContext,
    nodeId: string,
    incoming: Workflow['edges'],
): void {
    for (const edge of incoming) {
        if (context.getEdgeState(edge.id) === 'pending') {
            throw new Error(
                `Edge "${edge.id}" into "${nodeId}" is still pending — execution order is broken`,
            );
        }
    }
}

export async function executeNodes({
    workflow,
    context,
    services,
    runId,
    triggerPayload,
}: ExecuteNodesArgs): Promise<ExecuteNodesOutcome> {
    const order = topoSort(workflow.nodes, workflow.edges);
    const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));

    const incomingEdges = new Map<string, Workflow['edges']>();
    for (const edge of workflow.edges) {
        const edges = incomingEdges.get(edge.to) ?? [];
        edges.push(edge);
        incomingEdges.set(edge.to, edges);
    }

    let halted: Halt | undefined;

    for (const nodeId of order) {
        const node = nodesById.get(nodeId)!;
        const startedAt = services.clock.now();

        // The run has stopped, but we keep walking so the trace has a record for
        // every node. Pending is not skipped: nothing was decided about these
        // branches, so recordPending leaves their edges pending too.
        if (halted) {
            context.recordPending(
                makeStep({
                    nodeId,
                    state: 'pending',
                    startedAt,
                    finishedAt: startedAt,
                    durationMs: 0,
                }),
            );
            continue;
        }

        assertInputsSettled(context, nodeId, incomingEdges.get(nodeId) ?? []);

        if (!shouldRun(context, nodeId)) {
            context.recordSkipped(
                makeStep({
                    nodeId,
                    state: 'skipped',
                    startedAt,
                    finishedAt: startedAt,
                    durationMs: 0,
                }),
            );
            continue;
        }

        const definition = getNodeDefinition(node.type);

        if (!definition) {
            const error = {
                message: `Unknown node type "${node.type}"`,
                code: 'UNKNOWN_NODE_TYPE',
            };

            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt,
                    finishedAt: startedAt,
                    durationMs: 0,
                    error,
                }),
            );

            halted = { completed: false, haltedAt: nodeId, error };
            continue;
        }

        const startedMs = services.clock.nowMs();

        const resolved = resolveParams(
            definition,
            node.params,
            context.getOutputs(),
        );

        // A resolution failure is a node error, not a skip and not a crash: the
        // node genuinely failed, it just failed before its executor ran.
        if (!resolved.ok) {
            const error = {
                message: resolved.problems
                    .map((problem) => `${problem.param}: ${problem.message}`)
                    .join('; '),
                code: 'PARAM_RESOLUTION_FAILED',
            };

            // No resolvedParams — resolution is precisely what failed.
            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt,
                    finishedAt: services.clock.now(),
                    durationMs: services.clock.nowMs() - startedMs,
                    error,
                }),
            );

            halted = { completed: false, haltedAt: nodeId, error };
            continue;
        }

        const params = resolved.params as Record<string, unknown>;

        let result: NodeResult;

        try {
            result = await dispatch(node.type, {
                params,
                runId,
                nodeId,
                triggerPayload,
                services,
            });
        } catch (thrown) {
            // Services throw on timeouts and blocked addresses. Turning that into
            // a node error keeps the trace complete; one network blip should not
            // destroy the record of everything that already ran.
            result = {
                status: 'error',
                error: {
                    message:
                        thrown instanceof Error ? thrown.message : String(thrown),
                    code: thrown instanceof Error ? thrown.name : 'UNKNOWN_ERROR',
                },
            };
        }

        const finishedAt = services.clock.now();
        const durationMs = services.clock.nowMs() - startedMs;

        if (result.status === 'error') {
            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt,
                    finishedAt,
                    durationMs,
                    resolvedParams: params,
                    error: result.error,
                }),
            );

            halted = { completed: false, haltedAt: nodeId, error: result.error };
            continue;
        }

        context.recordSuccess(
            makeStep({
                nodeId,
                state: 'success',
                startedAt,
                finishedAt,
                durationMs,
                resolvedParams: params,
                output: result.output,
                firedPorts: result.firedPorts,
            }),
        );
    }

    return halted ?? { completed: true };
}
