import { NodeState } from "./run-state";

export interface StepRecord {
    nodeId: string;
    state: NodeState;
    resolvedParams?: Record<string, unknown>;
    output?: unknown;
    error?: {
        message: string;
        code?: string;
    };
    firedPorts: string[];
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    attempt: number;
}