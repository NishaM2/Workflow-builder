import type { NodeDefinition } from '../schemas/node-definition';

import { manualTrigger } from './manual-trigger';
import { webhookTrigger } from './webhook-trigger';
import { httpRequest } from './http-request';
import { llmPrompt } from './llm-prompt';
import { slackPost } from './slack-post';
import { logicIf } from './if';

export * from './manual-trigger';
export * from './webhook-trigger';
export * from './http-request';
export * from './llm-prompt';
export * from './slack-post';
export * from './if';

const all = [manualTrigger, webhookTrigger, httpRequest, llmPrompt, slackPost, logicIf]

export const CATALOG: Record<string, NodeDefinition> = Object.fromEntries(
    all.map((def) => [def.id, def]),
)

export const CATALOG_LIST: NodeDefinition[] = all;

export const getNodeDefinition = (type: string): NodeDefinition | undefined => CATALOG[type];