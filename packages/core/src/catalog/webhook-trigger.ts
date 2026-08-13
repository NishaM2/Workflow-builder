import { z } from 'zod';
import { defineNode } from '../schemas/node-definition';

export const webhookTrigger = defineNode({
    id: 'webhook.trigger',
    version: 1,
    displayName: 'Webhook Trigger',
    description: 'Receives an incoming HTTP webhook request and starts the workflow. Use when an external service or application should trigger the workflow by sending an HTTP request.',
    category: 'trigger',
    outputs: [{ id: 'main', label: 'Output' }],
    parameters: z.object({
        path: z.string().describe('The URL path that receives the webhook request, e.g. /webhooks/github'),
        method: z.enum(['GET', 'POST']).describe('HTTP method accepted by the webhook')
    }),
    output: z.object({
        body: z.unknown(),
        headers: z.record(z.string(), z.string()),
        query: z.record(z.string(), z.string()),
        method: z.string(),
    })
})