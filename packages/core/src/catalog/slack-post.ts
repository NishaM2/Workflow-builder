import { z } from 'zod';
import { defineNode } from '../schemas/node-definition';

export const slackPost = defineNode({
    id: 'slack.post',
    version: 1,
    displayName: 'Slack Post',
    description: 'Sends a message to a Slack channel. Use when the user wants to notify a team, alert someone, post an update, send a message, or ping a channel.',
    category: 'action',
    outputs: [{ id: 'main', label: 'Output'}],
    parameters: z.object({
        channel: z.string().describe('Slack channel, e.g. #engineering'),
        message: z.string().describe('The message text to post'),
    }),
    output: z.object({
        ok: z.boolean(),
        ts: z.string().describe('Slack message timestamp'),
    })
})