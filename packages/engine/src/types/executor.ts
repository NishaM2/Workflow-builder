import type { NodeResult } from '@flow/core';
import type { Services } from './services';

export interface ExecutorArgs<TParams = Record<string, unknown>> {
    params: TParams;
    runId: string;
    nodeId: string;
    triggerPayload: unknown;
    services: Services;
}

export type Executor<TParams = Record<string, unknown>> = (args: ExecutorArgs<TParams>) => Promise<NodeResult>;