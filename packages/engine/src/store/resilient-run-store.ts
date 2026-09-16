import { reportFailure } from '../services/logger';
import type { RunStore, Services } from '../types';

// Wraps a store so its failures never end a run. A Postgres blip is logged and the
// run carries on; the write it lost stays lost. Recording the work is not the work.
export function resilientRunStore(
    inner: RunStore,
    logger: Services['logger'],
): RunStore {
    const guard = async (
        operation: string,
        runId: string,
        write: () => Promise<void>,
    ): Promise<void> => {
        try {
            await write();
        } catch (error) {
            reportFailure(logger, `Run store ${operation} failed; the run continues`, error, {
                runId,
            });
        }
    };

    return {
        startRun: (input) =>
            guard('startRun', input.runId, () => inner.startRun(input)),
        recordStep: (runId, step) =>
            guard('recordStep', runId, () => inner.recordStep(runId, step)),
        finishRun: (input) =>
            guard('finishRun', input.runId, () => inner.finishRun(input)),
    };
}
