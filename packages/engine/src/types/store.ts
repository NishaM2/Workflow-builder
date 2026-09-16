import type { Workflow } from "@flow/core";
import type { RunStatus } from "./run-state";
import type { StepRecord } from "./step";

export interface StartRunInput {
    runId: string;
    workflowId: string;
    workflowSnapshot: Workflow;
    triggerPayload: unknown;
    startedAt: string;
}

export interface FinishRunInput {
    runId: string;
    status: RunStatus;
    finishedAt: string;
}

export interface RunStore {
    startRun(input: StartRunInput): Promise<void>;
    recordStep(runId: string, step: StepRecord): Promise<void>;
    finishRun(input: FinishRunInput): Promise<void>;
}