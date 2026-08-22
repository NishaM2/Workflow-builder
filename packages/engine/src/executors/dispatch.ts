import { getNodeDefinition } from '@flow/core';
import type { NodeResult } from '@flow/core';
import type { ExecutorArgs } from '../types';
import { getExecutor } from './index';

export async function dispatch(
    type: string,
    args: ExecutorArgs,
): Promise<NodeResult> {
    const definition = getNodeDefinition(type);
    const executor = getExecutor(type);

    if (!definition || !executor) {
        return {
            status: 'error',
            error: { message: `No executor for node type "${type}"`, code: 'NO_EXECUTOR' },
        };
    }

    const result = await executor(args);

    if (result.status === 'error') return result;

    // The declared output shape is the contract the validator promised the user.
    const parsed = definition.output.safeParse(result.output);

    if (!parsed.success) {
        return {
            status: 'error',
            error: {
                message: `Executor for "${type}" returned an output that does not match its declared shape`,
                code: 'INVALID_OUTPUT',
            },
        };
    }

    const validPorts = new Set(definition.outputs.map((port) => port.id));
    const badPort = result.firedPorts.find((port) => !validPorts.has(port));

    if (badPort) {
        return {
            status: 'error',
            error: {
                message: `Executor for "${type}" fired unknown port "${badPort}"`,
                code: 'INVALID_PORT',
            },
        };
    }
    return { ...result, output: parsed.data };
}