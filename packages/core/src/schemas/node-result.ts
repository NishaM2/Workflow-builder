import { z } from 'zod';

export const NodeResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('success'), output: z.unknown(), firedPorts: z.array(z.string())}),
    z.object({ status: z.literal('error'), error: z.object({ message: z.string(), code: z.string().optional()})})
])

export type NodeResult = z.infer<typeof NodeResultSchema>;