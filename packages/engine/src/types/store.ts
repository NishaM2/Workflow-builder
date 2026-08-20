import type { Workflow } from "@flow/core";
import type { RunStatus } from "./run-state";
import type { StepRecord } from "./step";

export interface RunStore {
    startRun(input: {
        runId: string;
        workflowId: string;
        workflowSnapshot: Workflow;
        triggerPayload: unknown;
        startedAt: string;
    }): Promise<void>;
    recordStep(runId: string, step: StepRecord): Promise<void>;
    finishRun(input: {
        runId: string;
        status: RunStatus;
        finishedAt: string;
    }): Promise<void>;
}