import { z } from 'zod';
import { PlaceholderSchema } from './placeholder';

export const ParameterValueSchema = z.discriminatedUnion('kind',[
    z.object({ kind: z.literal('literal'), value: z.unknown()}),
    z.object({ kind: z.literal('template'), template: z.string()}),
    z.object({ kind: z.literal('placeholder'), placeholder: PlaceholderSchema})
]);

export type ParameterValue = z.infer<typeof ParameterValueSchema>;