import type { NodeResult } from '@flow/core';
import type { Services } from './services';

export interface ExecutorArgs<TParams = Record<string, unknown>> {
    runId: string;
    nodeId: string;
    triggerPayload: unknown;
    params: Record<string, unknown>;
    services: Services;
}

export type Executor<TParams = Record<string, unknown>> = (args: ExecutorArgs<TParams>) => Promise<NodeResult>;