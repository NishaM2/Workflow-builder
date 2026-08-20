import type { Workflow } from "@flow/core";
import type { Services } from "./services";
import type { RunStore } from "./store";

export interface ExecutionPolicy {
    onError: 'stop' | 'continue';
    retryCount: number;
    timeoutMs: number;
}

export interface RunOptions {
    workflow: Workflow;
    triggerPayload: unknown;
    services: Services;
    store: RunStore;
    policy: ExecutionPolicy;
}