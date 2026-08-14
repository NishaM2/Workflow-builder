import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

export const nodeTypes = pgTable('node_types', {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    outputs: jsonb('outputs').notNull(),
    parameterSchema: jsonb('parameter_schema').notNull(),
    outputSchema: jsonb('output_schema').notNull(),
},
(table) => [
    primaryKey({
        columns: [table.id, table.version],
    }),
    check(
        'node_types_category_check',
        sql`${table.category} IN ('trigger', 'action', 'logic')`,
    ),
])

