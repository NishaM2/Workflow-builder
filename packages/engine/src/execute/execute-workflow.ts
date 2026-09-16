import { randomUUID } from 'node:crypto';
import { RunContext } from '../context/run-context';
import type { RunOptions, RunResult } from '../types';
import { deriveStatus, firstFailedStep } from './derive-status';
import { executeNodes, sampleClock } from './execute-nodes';
import { preflight } from './preflight';

// A run is identified independently of the workflow it came from: it outlives the
// graph it snapshotted, and two runs of the same graph must never collide.
function newRunId(): string {
    return `run_${randomUUID()}`;
}

// The only entry point. Everything beneath it is internals, and everything that
// makes a run a run rather than a graph walk — the id, the store, the wall clock —
// lives here and nowhere else. executeNodes stays free of all three, which is why
// its tests need three lines of setup instead of a database.
export async function executeWorkflow(options: RunOptions): Promise<RunResult> {
    const { workflow, triggerPayload, services, store, policy } = options;

    const runId = newRunId();

    // The gate. A blocked run never started: nothing reaches the store, no clock is
    // read, and the result carries no steps and no timings because there was
    // nothing to time.
    //
    // Neither refusal is an exception and neither is an error. "This workflow is not
    // ready" is an answer about the graph, not a report of something going wrong
    // while running it, and the two want opposite responses from the caller: one is
    // fixed by filling in a field, the other by looking at what broke.
    const gate = preflight(workflow);

    if (!gate.ok) {
        return {
            runId,
            workflowId: workflow.id,
            status: 'blocked',
            blockers: gate.blockers,
            validationErrors: gate.validationErrors,
        };
    }

    const started = sampleClock(services.clock);

    await store.startRun({
        runId,
        workflowId: workflow.id,
        // Snapshotted, so a run stays readable after its workflow is edited.
        workflowSnapshot: workflow,
        triggerPayload,
        startedAt: started.iso,
    });

    const context = new RunContext(workflow);

    // Steps are written as they happen rather than in one batch at the end, so a
    // process that dies mid-walk still leaves a record of how far it got. A store
    // that fails is contained by executeNodes, which logs the listener failure and
    // carries on: recording the work is not the work.
    await executeNodes({
        workflow,
        context,
        services,
        runId,
        triggerPayload,
        policy,
        onStep: (step) => store.recordStep(runId, step),
    });

    const steps = context.getSteps();

    // The steps are the authority on the verdict, not the walk's outcome.
    // executeNodes records the node it halted at as an error before it returns, so
    // every halt is already visible here. The one halt it cannot attribute to a
    // node is a graph it could not walk at all, which means a cycle — and the gate
    // above refused that before the run started.
    const status = deriveStatus(steps);
    const finished = sampleClock(services.clock);

    await store.finishRun({ runId, status, finishedAt: finished.iso });

    const base = {
        runId,
        workflowId: workflow.id,
        steps,
        startedAt: started.iso,
        finishedAt: finished.iso,
        durationMs: finished.ms - started.ms,
    };

    if (status === 'success') return { ...base, status };

    // deriveStatus returns 'error' exactly when some step is in error, so there is
    // always one to name here.
    const failed = firstFailedStep(steps)!;

    return {
        ...base,
        status,
        failedNodeId: failed.nodeId,
        error: failed.error ?? { message: `Node "${failed.nodeId}" failed` },
    };
}
