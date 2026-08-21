import { z } from 'zod';
import { defineNode } from '../schemas/node-definition';

export const logicIf = defineNode({
    id: 'logic.if',
    version: 1,
    displayName: 'IF',
    description: 'Evaluates a condition and routes the workflow through either the true or false path. Use when the workflow needs to make a decision based on data from previous nodes.',
    category: 'logic',
    outputs: [{ id: 'true', label: 'True'}, { id: 'false', label: 'False'}],
    parameters: z.object({
        left: z.union([z.string(), z.number(), z.boolean()]).describe('The value to evaluate. Can contain a {{...}} reference to data from a previous node.'),
        operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than']).describe('The comparison operation to perform between the left and right values.'),
        right: z.union([z.string(), z.number(), z.boolean()]).describe('The value to compare against. Can be a literal value or a {{...}} reference.')
    }),
    output: z.object({})
})