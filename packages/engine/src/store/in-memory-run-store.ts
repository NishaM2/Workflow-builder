import type { Workflow } from '@flow/core';
import type {
    FinishRunInput,
    RunStatus,
    RunStore,
    StartRunInput,
    StepRecord,
} from '../types';

export interface StoredRun {
    runId: string;
    workflowId: string;
    workflowSnapshot: Workflow;
    triggerPayload: unknown;
    status: RunStatus;
    startedAt: string;
    finishedAt?: string;
    steps: StepRecord[];
}

// Keeps runs in memory exactly as given: no redaction and no size cap. Tests want
// the real values, and neither concern applies to data that never leaves the process.
export class InMemoryRunStore implements RunStore {
    private readonly runs = new Map<string, StoredRun>();

    async startRun(input: StartRunInput): Promise<void> {
        this.runs.set(input.runId, { ...input, status: 'running', steps: [] });
    }

    async recordStep(runId: string, step: StepRecord): Promise<void> {
        const run = this.require(runId);

        // One record per node, like run_steps' primary key: a later one replaces it.
        const index = run.steps.findIndex((existing) => existing.nodeId === step.nodeId);

        if (index === -1) run.steps.push(step);
        else run.steps[index] = step;
    }

    async finishRun(input: FinishRunInput): Promise<void> {
        const run = this.require(input.runId);

        run.status = input.status;
        run.finishedAt = input.finishedAt;
    }

    getRun(runId: string): StoredRun | undefined {
        return this.runs.get(runId);
    }

    // A step for a run that was never started fails, as the foreign key would.
    private require(runId: string): StoredRun {
        const run = this.runs.get(runId);
        if (!run) throw new Error(`No run "${runId}" has been started`);

        return run;
    }
}
