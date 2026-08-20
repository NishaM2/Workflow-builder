import type { Placeholder, ValidationError } from '@flow/core';
import type { StepRecord } from './step';

export interface Blocker {
  nodeId: string;
  param: string;
  placeholder: Placeholder;
}

interface RunResultBase {
  runId: string;
  workflowId: string;
}

export type RunResult =
    | (RunResultBase & {
        status: 'success';
        steps: StepRecord[];
        startedAt: string;
        finishedAt: string;
        durationMs: number;
        })
    | (RunResultBase & {
        status: 'error';
        steps: StepRecord[];
        failedNodeId: string;
        error: { message: string; code?: string };
        startedAt: string;
        finishedAt: string;
        durationMs: number;
        })
    | (RunResultBase & {
        status: 'blocked';
        blockers: Blocker[];
        validationErrors: ValidationError[];
        });