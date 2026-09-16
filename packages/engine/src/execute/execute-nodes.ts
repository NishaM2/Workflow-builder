import { getNodeDefinition, topoSort } from '@flow/core';
import type { Workflow } from '@flow/core';
import { RunContext } from '../context/run-context';
import { dispatch } from '../executors/dispatch';
import { resolveParams } from '../resolve/resolve-params';
import { reportFailure } from '../services/logger';
import type { ExecutionPolicy, NodeState, Services, StepRecord } from '../types';
import { withRetries } from './with-retries';


export interface ExecuteNodesArgs {
    workflow: Workflow;
    context: RunContext;
    services: Services;
    runId: string;
    triggerPayload: unknown;
    policy: ExecutionPolicy;
    // Given each step as soon as it is recorded; the walk waits for it before moving on.
    onStep?: (step: StepRecord) => void | Promise<void>;
}

// completed: true means the walk reached the end. Under onError 'continue' that
// includes runs where some nodes failed; their steps say so.
export type ExecuteNodesOutcome =
    | { completed: true }
    | {
        completed: false;
        // null when the graph itself could not be walked, e.g. it contains a cycle.
        haltedAt: string | null;
        error: { message: string; code?: string };
    };

type Halt = Extract<ExecuteNodesOutcome, { completed: false }>;

interface StepInput {
    nodeId: string;
    state: NodeState;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    attempt?: number;
    firedPorts?: string[];
    resolvedParams?: Record<string, unknown>;
    output?: unknown;
    error?: { message: string; code?: string };
}

// One place to build a step record, so a change to its shape happens here rather
// than in every branch. Attempts default to 0: only a node that reaches dispatch
// has made one.
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
        attempt: input.attempt ?? 0,
    };
}

// Read the clock once and derive the ISO string from that same instant, so a
// step's timestamps and its duration can never describe different moments.
export function sampleClock(clock: Services['clock']): { ms: number; iso: string } {
    const ms = clock.nowMs();

    return { ms, iso: new Date(ms).toISOString() };
}

// A node that never started: a single instant, no duration, no attempts.
function notStartedStep(
    clock: Services['clock'],
    nodeId: string,
    state: 'skipped' | 'pending',
): StepRecord {
    const now = sampleClock(clock);

    return makeStep({
        nodeId,
        state,
        startedAt: now.iso,
        finishedAt: now.iso,
        durationMs: 0,
    });
}

// topoSort's only failure is a cycle, which it reports by throwing. Validation
// rejects cycles before a run starts, but executeNodes is exported and directly
// callable, so here the cycle becomes data instead of escaping as a throw.
function walkOrder(workflow: Workflow): string[] | null {
    try {
        return topoSort(workflow.nodes, workflow.edges);
    } catch {
        return null;
    }
}

// A node runs because something reached it, never because of what it is. There
// is deliberately no catalog lookup here — the trigger runs because nothing
// feeds it, which is the same rule every other node follows.
function shouldRun(context: RunContext, nodeId: string): boolean {
    if (!context.hasIncomingEdges(nodeId)) return true;

    return context.hasActiveIncomingEdge(nodeId);
}

export async function executeNodes({
    workflow,
    context,
    services,
    runId,
    triggerPayload,
    policy,
    onStep,
}: ExecuteNodesArgs): Promise<ExecuteNodesOutcome> {
    // Each recorded step goes to onStep straight away, and the walk waits for it. A
    // slow listener, a database say, slows execution: for v1 that keeps steps in order
    // and the code simple. Phase 4's SSE stream will want this same call, and that is
    // the moment to consider buffering. A listener that fails is logged, never fatal.
    const announce = async (nodeId: string) => {
        const step = context.getStep(nodeId);
        if (!onStep || !step) return;

        try {
            await onStep(step);
        } catch (error) {
            reportFailure(services.logger, 'A step listener failed; the run continues', error, {
                runId,
                nodeId,
            });
        }
    };

    const order = walkOrder(workflow);

    if (!order) {
        // Nothing was reached, but every node still gets a record: no holes.
        for (const node of workflow.nodes) {
            context.recordPending(notStartedStep(services.clock, node.id, 'pending'));
            await announce(node.id);
        }

        return {
            completed: false,
            haltedAt: null,
            error: { message: 'Workflow contains a cycle', code: 'CYCLE_DETECTED' },
        };
    }

    const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));

    let halted: Halt | undefined;

    for (const nodeId of order) {
        const node = nodesById.get(nodeId)!;

        // Skipped versus never-reached is read from the edge states. The halt flag
        // only stops execution, so a node's state can't depend on where it sorted.
        const pendingInput = context
            .getIncomingEdges(nodeId)
            .find((edge) => context.getEdgeState(edge.id) === 'pending');

        // In a healthy run every upstream node is recorded before we arrive, so
        // every input is settled. A pending one means the walk order is broken.
        if (pendingInput && !halted) {
            throw new Error(
                `Edge "${pendingInput.id}" into "${nodeId}" is still pending — execution order is broken`,
            );
        }

        // Never reached: something upstream was never reached either, so nothing
        // was ever decided about this branch. Only possible once the run halts.
        if (pendingInput) {
            context.recordPending(notStartedStep(services.clock, nodeId, 'pending'));
            await announce(nodeId);
            continue;
        }

        // Decided against: every input is settled and none is active. That holds
        // whether or not the run has halted.
        if (!shouldRun(context, nodeId)) {
            context.recordSkipped(notStartedStep(services.clock, nodeId, 'skipped'));
            await announce(nodeId);
            continue;
        }

        // Would have run, but the run has stopped.
        if (halted) {
            context.recordPending(notStartedStep(services.clock, nodeId, 'pending'));
            await announce(nodeId);
            continue;
        }

        const started = sampleClock(services.clock);
        const definition = getNodeDefinition(node.type);

        // A node's own onError overrides the run's.
        //
        // 'stop' halts the walk and leaves the failed node's edges pending, since
        // nothing downstream was ever reached. 'continue' means only "don't halt":
        // the edges still die, so everything downstream of the failure is skipped.
        // Activating them instead would run nodes whose templates point at an output
        // that doesn't exist. What 'continue' buys is that independent branches keep
        // running.
        const haltsRun = (node.onError ?? policy.onError) === 'stop';

        // dispatch reports this same condition under the same code. The lookup is
        // repeated here only because resolveParams needs the definition first.
        if (!definition) {
            const error = {
                message: `Unknown node type "${node.type}"`,
                code: 'UNKNOWN_NODE_TYPE',
            };

            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt: started.iso,
                    finishedAt: started.iso,
                    durationMs: 0,
                    error,
                }),
                { haltsRun },
            );
            await announce(nodeId);

            if (haltsRun) halted = { completed: false, haltedAt: nodeId, error };
            continue;
        }

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
            const finished = sampleClock(services.clock);

            // No resolvedParams — resolution is precisely what failed. No attempt
            // either, since the executor was never called.
            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt: started.iso,
                    finishedAt: finished.iso,
                    durationMs: finished.ms - started.ms,
                    error,
                }),
                { haltsRun },
            );
            await announce(nodeId);

            if (haltsRun) halted = { completed: false, haltedAt: nodeId, error };
            continue;
        }

        // Retries, backoff and the policy timeout all live in withRetries, which
        // always resolves: nothing a service throws escapes into the walk.
        const { result, attempts } = await withRetries({
            nodeType: node.type,
            invoke: () =>
                dispatch(node.type, {
                    params: resolved.params,
                    runId,
                    nodeId,
                    triggerPayload,
                    services,
                }),
            clock: services.clock,
            retryCount: policy.retryCount,
            timeoutMs: policy.timeoutMs,
        });

        const finished = sampleClock(services.clock);

        if (result.status === 'error') {
            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt: started.iso,
                    finishedAt: finished.iso,
                    durationMs: finished.ms - started.ms,
                    attempt: attempts,
                    resolvedParams: resolved.params,
                    error: result.error,
                }),
                { haltsRun },
            );
            await announce(nodeId);

            if (haltsRun) {
                halted = { completed: false, haltedAt: nodeId, error: result.error };
            }
            continue;
        }

        context.recordSuccess(
            makeStep({
                nodeId,
                state: 'success',
                startedAt: started.iso,
                finishedAt: finished.iso,
                durationMs: finished.ms - started.ms,
                attempt: attempts,
                resolvedParams: resolved.params,
                output: result.output,
                firedPorts: result.firedPorts,
            }),
        );
        await announce(nodeId);
    }

    return halted ?? { completed: true };
}
