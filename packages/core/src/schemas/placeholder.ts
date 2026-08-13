import { z } from 'zod';

export const PlaceholderSchema = z.object({
    type: z.enum(['slack_channel', 'url', 'api_key', 'text']),
    prompt: z.string(),
    reason: z.enum(['not_specified', 'invalid_value', 'unknown_reference']),
    suggestions: z.array(z.string()).optional(),
})

export type Placeholder = z.infer<typeof PlaceholderSchema>;