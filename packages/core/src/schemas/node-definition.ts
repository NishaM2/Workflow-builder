import { z } from 'zod';

export type OutputPort = {
    id: string;
    label: string;
}

export type NodeDefinition = {
    id: string;
    version: number;
    displayName: string;
    description: string;
    category: 'trigger' | 'action' | 'logic';
    outputs: OutputPort[];
    parameters: z.ZodObject<z.ZodRawShape>
    output: z.ZodObject<z.ZodRawShape>
}

export const isTrigger = (def:NodeDefinition) => def.category === 'trigger';
export const defineNode = (def: NodeDefinition): NodeDefinition => def;
