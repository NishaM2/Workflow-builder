import { z } from 'zod';
import { defineNode } from '../schemas/node-definition';

export const httpRequest = defineNode({
    id: 'http.request',
    version: 1,
    displayName: 'HTTP Request',
    description: 'Makes an HTTP request to an external URL. Use when the workflow needs to fetch data from an API, send data to an API, or communicate with an external web service.',
    category: 'action',
    outputs: [{ id: 'main', label: 'Output' }],
    parameters: z.object({
        url: z.string().describe('The URL to send the HTTP request to. May contain {{...}} references.'),
        method: z.enum(['GET', 'POST', 'PUT']).describe('The HTTP method to use for the request.'),
        headers: z.record(z.string(), z.string()).optional().describe('HTTP headers to send with the request, such as Authorization or Content-Type.'),
        body: z.unknown().optional().describe('The data to send in the request body. Usually used with POST or PUT requests.'),
        timeout: z.number().int().positive().default(30000).describe('Maximum time to wait for the request to complete, in milliseconds.'),
    }),
    output: z.object({
        status: z.number().int(),
        headers: z.record(z.string(), z.string()),
        body: z.unknown(),
    })
})