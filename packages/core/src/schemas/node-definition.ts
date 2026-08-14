import { z } from 'zod';

export type OutputPort = {
  id: string;
  label: string;
};

export type NodeDefinition<
  P extends z.ZodRawShape = z.ZodRawShape,
  O extends z.ZodRawShape = z.ZodRawShape,
> = {
  id: string;
  version: number;
  displayName: string;
  description: string;
  category: 'trigger' | 'action' | 'logic';
  outputs: OutputPort[];
  parameters: z.ZodObject<P>;
  output: z.ZodObject<O>;
};

export const isTrigger = (def: NodeDefinition) =>
  def.category === 'trigger';

export const defineNode = <
  P extends z.ZodRawShape,
  O extends z.ZodRawShape,
>(
  def: NodeDefinition<P, O>,
): NodeDefinition<P, O> => def;