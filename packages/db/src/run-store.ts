import { redactingRunStore, resilientRunStore } from '@flow/engine';
import type {
    FinishRunInput,
    RunStore,
    Services,
    StartRunInput,
    StepRecord,
} from '@flow/engine';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';
import { runs, runSteps } from './schema';

export type FlowDatabase = PostgresJsDatabase<typeof schema>;

// Writes runs and steps exactly as given. Deliberately not exported: the only way to
// reach Postgres is through PostgresRunStore, which redacts and contains failures first.
function postgresWriter(db: FlowDatabase): RunStore {
    return {
        async startRun(input) {
            await db.insert(runs).values({
                id: input.runId,
                workflowId: input.workflowId,
                workflowSnapshot: input.workflowSnapshot,
                triggerPayload: input.triggerPayload ?? null,
                status: 'running',
                startedAt: input.startedAt,
            });
        },

        async recordStep(runId, step) {
            const values = {
                state: step.state,
                resolvedParams: step.resolvedParams ?? null,
                output: step.output ?? null,
                error: step.error ?? null,
                firedPorts: step.firedPorts,
                startedAt: step.startedAt,
                durationMs: step.durationMs,
                attempt: step.attempt,
            };

            // One row per node per run. A later record of the same node, such as a
            // Phase 4 'running' update followed by its result, replaces the earlier one.
            await db
                .insert(runSteps)
                .values({ runId, nodeId: step.nodeId, ...values })
                .onConflictDoUpdate({
                    target: [runSteps.runId, runSteps.nodeId],
                    set: values,
                });
        },

        async finishRun(input) {
            await db
                .update(runs)
                .set({ status: input.status, finishedAt: input.finishedAt })
                .where(eq(runs.id, input.runId));
        },
    };
}

// The RunStore for real runs. Redaction and failure containment are built in rather
// than left to the caller to remember: nothing reaches the database unredacted, and
// no database failure reaches the run.
export class PostgresRunStore implements RunStore {
    private readonly store: RunStore;

    constructor(db: FlowDatabase, logger: Services['logger']) {
        this.store = resilientRunStore(redactingRunStore(postgresWriter(db)), logger);
    }

    startRun(input: StartRunInput): Promise<void> {
        return this.store.startRun(input);
    }

    recordStep(runId: string, step: StepRecord): Promise<void> {
        return this.store.recordStep(runId, step);
    }

    finishRun(input: FinishRunInput): Promise<void> {
        return this.store.finishRun(input);
    }
}
