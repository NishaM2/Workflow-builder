import { getNodeDefinition } from '../catalog';
import { WorkflowSchema } from '../schemas';
import type { NodeDefinition } from '../schemas';
import type { ValidationError } from './errors';
import { REFERENCE_PATTERN } from '../utils/reference';
import { z } from 'zod';

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
};

// Topological sort
export function topoSort(
  nodes: { id: string }[],
  edges: { from: string; to: string }[],
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Skip dangling edges — they're reported separately by edge validation,
  // and counting them here would create phantom cycles.
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;

    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const result: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);

    for (const nextNode of adjacency.get(nodeId) ?? []) {
      const newDegree = (inDegree.get(nextNode) ?? 0) - 1;
      inDegree.set(nextNode, newDegree);
      if (newDegree === 0) queue.push(nextNode);
    }
  }

  if (result.length !== nodes.length) {
    throw new Error('Graph contains a cycle');
  }

  return result;
}

// A schema is optional if it accepts `undefined` (covers .optional() and .default()).
function isOptionalSchema(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success;
}

// Peel .optional() / .default() / .nullable() wrappers to reach the real schema.
function unwrapSchema(schema: z.ZodType): z.ZodType {
  let current: any = schema;

  for (let i = 0; i < 10; i++) {
    if (typeof current?.unwrap === 'function') {
      current = current.unwrap();
      continue;
    }
    if (current?._def?.innerType) {
      current = current._def.innerType;
      continue;
    }
    break;
  }

  return current as z.ZodType;
}

// Does `segments` describe a real path inside `schema`?
function pathExistsInSchema(schema: z.ZodType, segments: string[]): boolean {
  let current = unwrapSchema(schema);

  for (const segment of segments) {
    // z.unknown() / z.any() — we genuinely can't know what's inside.
    if (current instanceof z.ZodUnknown || current instanceof z.ZodAny) {
      return true;
    }

    if (!(current instanceof z.ZodObject)) return false;

    const shape = current.shape as Record<string, z.ZodType>;
    const next = shape[segment];
    if (!next) return false;

    current = unwrapSchema(next);
  }

  return true;
}

// Every node reachable by walking edges backwards from `nodeId`. 
function upstreamOf(
  nodeId: string,
  edges: { from: string; to: string }[],
): Set<string> {
  const incoming = new Map<string, string[]>();

  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to)!.push(edge.from);
  }

  const seen = new Set<string>();
  const queue = [...(incoming.get(nodeId) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(incoming.get(current) ?? []));
  }

  return seen;
}

// Validator

export const validateWorkflow = (workflow: unknown): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Schema shape

  const parsed = WorkflowSchema.safeParse(workflow);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        code: 'INVALID_WORKFLOW',
        message: issue.message,
        path: issue.path.join('.'),
        severity: 'error',
      });
    }
    return { valid: false, errors, warnings };
  }

  const graph = parsed.data;

  // Duplicate node ids 

  const seenIds = new Set<string>();

  for (const node of graph.nodes) {
    if (seenIds.has(node.id)) {
      errors.push({
        code: 'INVALID_WORKFLOW',
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
        severity: 'error',
      });
    }
    seenIds.add(node.id);
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const defs = new Map<string, NodeDefinition>();

  // Node types and parameters 

  for (const node of graph.nodes) {
    const definition = getNodeDefinition(node.type);

    if (!definition) {
      errors.push({
        code: 'UNKNOWN_NODE_TYPE',
        message: `Unknown node type: ${node.type}`,
        nodeId: node.id,
        severity: 'error',
      });
      continue;
    }

    defs.set(node.id, definition);

    if (node.typeVersion !== definition.version) {
      errors.push({
        code: 'INVALID_TYPE_VERSION',
        message: `Node ${node.type} uses version ${node.typeVersion}, but version ${definition.version} is available.`,
        nodeId: node.id,
        severity: 'error',
      });
    }

    const shape = definition.parameters.shape as Record<string, z.ZodType>;

    // Missing required parameters
    for (const paramName of Object.keys(shape)) {
      const paramSchema = shape[paramName];
      if (!paramSchema) continue;
      if (paramName in node.params) continue;
      if (isOptionalSchema(paramSchema)) continue;

      errors.push({
        code: 'MISSING_PARAM',
        message: `Missing parameter: ${paramName}`,
        nodeId: node.id,
        path: paramName,
        severity: 'error',
      });
    }

    // Unknown parameters
    for (const paramName of Object.keys(node.params)) {
      if (!(paramName in shape)) {
        errors.push({
          code: 'INVALID_PARAM',
          message: `Unknown parameter: ${paramName}`,
          nodeId: node.id,
          path: paramName,
          severity: 'error',
        });
      }
    }

    // Parameter kinds and literal values
    for (const [paramName, param] of Object.entries(node.params)) {
      const paramSchema = shape[paramName];
      if (!paramSchema) continue;

      if (param.kind === 'placeholder') {
        warnings.push({
          code: 'UNRESOLVED_PLACEHOLDER',
          message: `Parameter "${paramName}" is unresolved`,
          nodeId: node.id,
          path: paramName,
          severity: 'warning',
        });
        continue;
      }

      // Templates are checked in step 6, once the graph is known.
      if (param.kind === 'template') continue;

      if (param.kind === 'literal') {
        const result = paramSchema.safeParse(param.value);

        if (!result.success) {
          errors.push({
            code: 'INVALID_PARAM',
            message: `Invalid value for parameter "${paramName}": ${result.error.issues[0]?.message ?? 'type mismatch'}`,
            nodeId: node.id,
            path: paramName,
            severity: 'error',
          });
        }
      }
    }
  }

  // Graph structure 

  const triggerNodes = graph.nodes.filter(
    (node) => defs.get(node.id)?.category === 'trigger',
  );

  if (triggerNodes.length === 0) {
    errors.push({
      code: 'MISSING_TRIGGER',
      message: 'Workflow must contain exactly one trigger',
      severity: 'error',
    });
  } else if (triggerNodes.length > 1) {
    errors.push({
      code: 'MULTIPLE_TRIGGERS',
      message: `Workflow must contain exactly one trigger, found ${triggerNodes.length}`,
      severity: 'error',
    });
  }

  if (triggerNodes.length === 1) {
    const trigger = triggerNodes[0]!;

    for (const edge of graph.edges) {
      if (edge.to === trigger.id) {
        errors.push({
          code: 'TRIGGER_HAS_INCOMING_EDGE',
          message: 'Trigger node cannot have an incoming edge',
          nodeId: trigger.id,
          severity: 'error',
        });
      }
    }

    // Reachability from the trigger
    const adjacency = new Map<string, string[]>();
    for (const node of graph.nodes) adjacency.set(node.id, []);

    for (const edge of graph.edges) {
      adjacency.get(edge.from)?.push(edge.to);
    }

    const visited = new Set<string>();
    const queue = [trigger.id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }

    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        errors.push({
          code: 'UNREACHABLE_NODE',
          message: `Node "${node.id}" is not reachable from the trigger`,
          nodeId: node.id,
          severity: 'error',
        });
      }
    }
  }

  // Edges 

  const edgeSet = new Set<string>();

  for (const edge of graph.edges) {
    const fromNode = nodeMap.get(edge.from);

    if (!fromNode) {
      errors.push({
        code: 'UNKNOWN_NODE',
        message: `Source node "${edge.from}" does not exist`,
        severity: 'error',
      });
      continue;
    }

    if (!nodeMap.has(edge.to)) {
      errors.push({
        code: 'UNKNOWN_NODE',
        message: `Destination node "${edge.to}" does not exist`,
        severity: 'error',
      });
      continue;
    }

    const definition = defs.get(fromNode.id);

    if (definition) {
      const portExists = definition.outputs.some((port) => port.id === edge.fromPort);

      if (!portExists) {
        errors.push({
          code: 'INVALID_EDGE',
          message: `Output port "${edge.fromPort}" does not exist on node "${edge.from}"`,
          nodeId: edge.from,
          severity: 'error',
        });
      }
    }

    const edgeKey = `${edge.from}:${edge.fromPort}->${edge.to}`;

    if (edgeSet.has(edgeKey)) {
      errors.push({
        code: 'INVALID_EDGE',
        message: `Duplicate edge: ${edgeKey}`,
        severity: 'error',
      });
    } else {
      edgeSet.add(edgeKey);
    }
  }

  // Template references 

  const upstreamCache = new Map<string, Set<string>>();

  for (const node of graph.nodes) {
    for (const [paramName, param] of Object.entries(node.params)) {
      if (param.kind !== 'template') continue;

      if (!upstreamCache.has(node.id)) {
        upstreamCache.set(node.id, upstreamOf(node.id, graph.edges));
      }
      const upstream = upstreamCache.get(node.id)!;

      for (const match of param.template.matchAll(REFERENCE_PATTERN)) {
        const raw = match[1]!;
        const [targetId, ...segments] = raw.split('.');
        if (!targetId) continue;

        if (!nodeMap.has(targetId)) {
          errors.push({
            code: 'INVALID_REFERENCE',
            message: `Reference "{{${raw}}}" points to unknown node "${targetId}"`,
            nodeId: node.id,
            path: paramName,
            severity: 'error',
          });
          continue;
        }

        if (!upstream.has(targetId)) {
          errors.push({
            code: 'INVALID_REFERENCE',
            message: `Reference "{{${raw}}}" points to "${targetId}", which is not upstream of "${node.id}"`,
            nodeId: node.id,
            path: paramName,
            severity: 'error',
          });
          continue;
        }

        const targetDef = defs.get(targetId);
        if (!targetDef) continue;

        if (!pathExistsInSchema(targetDef.output, segments)) {
          errors.push({
            code: 'INVALID_REFERENCE',
            message: `Reference "{{${raw}}}" — "${segments.join('.')}" does not exist on the output of "${targetId}"`,
            nodeId: node.id,
            path: paramName,
            severity: 'error',
          });
        }
      }
    }
  }

  // Cycles

  try {
    topoSort(graph.nodes, graph.edges);
  } catch {
    errors.push({
      code: 'CYCLE_DETECTED',
      message: 'Workflow contains a cycle',
      severity: 'error',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};