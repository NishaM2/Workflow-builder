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
// has made one, and Step 5 counts retries from there.
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
function sampleClock(clock: Services['clock']): { ms: number; iso: string } {
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
}: ExecuteNodesArgs): Promise<ExecuteNodesOutcome> {
    const order = walkOrder(workflow);

    if (!order) {
        // Nothing was reached, but every node still gets a record: no holes.
        for (const node of workflow.nodes) {
            context.recordPending(notStartedStep(services.clock, node.id, 'pending'));
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
            continue;
        }

        // Decided against: every input is settled and none is active. That holds
        // whether or not the run has halted.
        if (!shouldRun(context, nodeId)) {
            context.recordSkipped(notStartedStep(services.clock, nodeId, 'skipped'));
            continue;
        }

        // Would have run, but the run has stopped.
        if (halted) {
            context.recordPending(notStartedStep(services.clock, nodeId, 'pending'));
            continue;
        }

        const started = sampleClock(services.clock);
        const definition = getNodeDefinition(node.type);

        // dispatch reports this same condition under the same code. The lookup is
        // repeated here only because resolveParams needs the definition first.
        if (!definition) {
            const error = {
                message: `Unknown node type "${node.type}"`,
                code: 'UNKNOWN_NODE_TYPE',
            };

            // Every error halts the run in Step 4, so its outgoing edges stay
            // pending: what lies downstream was never reached, not decided against.
            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt: started.iso,
                    finishedAt: started.iso,
                    durationMs: 0,
                    error,
                }),
                { haltsRun: true },
            );

            halted = { completed: false, haltedAt: nodeId, error };
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
                { haltsRun: true },
            );

            halted = { completed: false, haltedAt: nodeId, error };
            continue;
        }

        let result: NodeResult;

        try {
            result = await dispatch(node.type, {
                params: resolved.params,
                runId,
                nodeId,
                triggerPayload,
                services,
            });
        } catch (thrown) {
            // Services throw on timeouts and blocked addresses. Turning that into
            // a node error keeps the trace complete; one network blip should not
            // destroy the record of everything that already ran.
            //
            // The code is the error's class name on purpose, not by accident: it
            // preserves RequestTimeoutError and BlockedAddressError, which is what
            // Step 5's retry classifier keys on. Anything generic reads 'Error'.
            result = {
                status: 'error',
                error: {
                    message:
                        thrown instanceof Error ? thrown.message : String(thrown),
                    code: thrown instanceof Error ? thrown.name : 'UNKNOWN_ERROR',
                },
            };
        }

        const finished = sampleClock(services.clock);

        if (result.status === 'error') {
            context.recordError(
                makeStep({
                    nodeId,
                    state: 'error',
                    startedAt: started.iso,
                    finishedAt: finished.iso,
                    durationMs: finished.ms - started.ms,
                    attempt: 1,
                    resolvedParams: resolved.params,
                    error: result.error,
                }),
                { haltsRun: true },
            );

            halted = { completed: false, haltedAt: nodeId, error: result.error };
            continue;
        }

        context.recordSuccess(
            makeStep({
                nodeId,
                state: 'success',
                startedAt: started.iso,
                finishedAt: finished.iso,
                durationMs: finished.ms - started.ms,
                attempt: 1,
                resolvedParams: resolved.params,
                output: result.output,
                firedPorts: result.firedPorts,
            }),
        );
    }

    return halted ?? { completed: true };
}
