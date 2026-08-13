import { z } from 'zod';
import { defineNode } from '../schemas/node-definition';

export const manualTrigger = defineNode({
    id: 'manual.trigger',
    version: 1,
    displayName: 'Manual Trigger',
    description: 'Starts a workflow when the user manually clicks the Run button. Use when the user wants to run an automation on demand or test a workflow manually.',
    category: 'trigger',
    outputs: [{ id: 'main', label: 'Output' }],
    parameters: z.object({}),
    output: z.object({})
})