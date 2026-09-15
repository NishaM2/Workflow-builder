import { z } from 'zod';
import { ParameterValueSchema } from './parameter-value';

export const NodeSchema = z.object({
    id: z.string(),
    type: z.string(),
    typeVersion: z.number().int().positive(),
    params: z.record(z.string(), ParameterValueSchema),
    label: z.string().optional(),
    // What the run does when this node fails once its retries are spent: halt the
    // walk, or carry on with independent branches. Unset inherits the run's policy.
    onError: z.enum(['stop', 'continue']).optional(),
    position: z.object({
        x: z.number(),
        y: z.number()
    })
});

export const EdgeSchema = z.object({
    id: z.string(),
    from: z.string(),
    fromPort: z.string(),
    to: z.string()
});

export const WorkflowSchema = z.object({
    id: z.string(),
    name: z.string(),
    version: z.number(),
    nodes: z.array(NodeSchema),
    edges: z.array(EdgeSchema)
})

export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowNode = z.infer<typeof NodeSchema>;
export type WorkflowEdge = z.infer<typeof EdgeSchema>;