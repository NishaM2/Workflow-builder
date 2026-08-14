import type { Workflow } from '@flow/core';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const workflows = pgTable('workflows', {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    graph: jsonb('graph').$type<Workflow>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
})