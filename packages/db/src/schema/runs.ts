import type { Workflow } from '@flow/core';
import { sql } from 'drizzle-orm';
import {
    check,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
} from 'drizzle-orm/pg-core';

// One row per run. The graph is snapshotted so a run stays readable after its
// workflow is edited.
//
// Ids are text, not uuid, and there is deliberately no foreign key to workflows:
// graph ids aren't uuids (the fixtures use names like workflow_if_1), a run needn't
// come from a saved workflow row, and history should outlive a deleted workflow.
export const runs = pgTable(
    'runs',
    {
        id: text('id').primaryKey(),
        workflowId: text('workflow_id').notNull(),
        workflowSnapshot: jsonb('workflow_snapshot').$type<Workflow>().notNull(),
        triggerPayload: jsonb('trigger_payload'),
        status: text('status').notNull(),
        startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
        finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
    },
    (table) => [
        // RunStatus in @flow/engine.
        check(
            'runs_status_check',
            sql`${table.status} IN ('running', 'success', 'error', 'blocked')`,
        ),
        index('runs_workflow_id_started_at_idx').on(table.workflowId, table.startedAt),
    ],
);

// One row per node per run, matching the engine's one step record per node. There is
// no finished_at: it is started_at + duration_ms, and two columns describing one
// moment could only ever disagree.
export const runSteps = pgTable(
    'run_steps',
    {
        runId: text('run_id')
            .notNull()
            .references(() => runs.id, { onDelete: 'cascade' }),
        nodeId: text('node_id').notNull(),
        state: text('state').notNull(),
        resolvedParams: jsonb('resolved_params').$type<Record<string, unknown>>(),
        output: jsonb('output'),
        error: jsonb('error').$type<{ message: string; code?: string }>(),
        firedPorts: text('fired_ports').array().notNull(),
        startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull(),
        durationMs: integer('duration_ms').notNull(),
        attempt: integer('attempt').notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.runId, table.nodeId] }),
        // NodeState in @flow/engine.
        check(
            'run_steps_state_check',
            sql`${table.state} IN ('pending', 'running', 'success', 'error', 'skipped')`,
        ),
    ],
);
