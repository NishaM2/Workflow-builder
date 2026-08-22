import type { Executor } from '../types';

export const manualTriggerExecutor: Executor = async () => {
    return {
        status: 'success',
        output: {},
        firedPorts: ['main'],
    };
};