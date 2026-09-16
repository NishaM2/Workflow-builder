import type { WorkflowNode } from '@flow/core';
import type { RunStore } from '../types';
import { redactStep, redactValue } from './redact';
import { toStorable } from './storable';

// Wraps a store so everything reaching it is fit to persist: credentials masked and
// oversized fields capped. This is the store boundary. The loop and the in-memory
// store keep real values; only what gets written down is cleaned.
export function redactingRunStore(inner: RunStore): RunStore {
    // Each run's graph, so a step can be checked against its own node's params.
    const nodesByRun = new Map<string, Map<string, WorkflowNode>>();

    return {
        async startRun(input) {
            nodesByRun.set(
                input.runId,
                new Map(input.workflowSnapshot.nodes.map((node) => [node.id, node])),
            );

            // The snapshot keeps literal header values a user typed in, so it is
            // redacted too, or every run would store another copy of them.
            await inner.startRun({
                ...input,
                workflowSnapshot: redactValue(input.workflowSnapshot),
                triggerPayload: toStorable(redactValue(input.triggerPayload)),
            });
        },

        async recordStep(runId, step) {
            const redacted = redactStep(step, nodesByRun.get(runId)?.get(step.nodeId));

            // Redact before capping, so a preview can never carry a credential.
            await inner.recordStep(runId, {
                ...redacted,
                // A record in gives a record out: the value itself, or the marker.
                resolvedParams: toStorable(redacted.resolvedParams) as
                    | Record<string, unknown>
                    | undefined,
                output: toStorable(redacted.output),
            });
        },

        async finishRun(input) {
            nodesByRun.delete(input.runId);
            await inner.finishRun(input);
        },
    };
}
