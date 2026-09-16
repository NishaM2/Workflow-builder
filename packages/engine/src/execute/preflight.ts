import { validateWorkflow } from '@flow/core';
import type { ValidationError, Workflow } from '@flow/core';
import type { Blocker } from '../types';

export interface PreflightResult {
    // False if either list has anything in it. The run is refused, not attempted.
    ok: boolean;
    validationErrors: ValidationError[];
    blockers: Blocker[];
}

// Every parameter still waiting on a human, in the order the canvas draws them:
// node order, then parameter order within a node.
//
// This reads the graph rather than validateWorkflow's UNRESOLVED_PLACEHOLDER
// warnings, because a warning is a sentence and a blocker is data. Whatever asks
// the question — a canvas field, a CLI prompt — needs the Placeholder itself: its
// prompt, its type, its suggestions. Recovering that by re-parsing a message would
// be a worse version of this loop.
//
// Exported on its own because counting what is left to fill in is not the same
// question as running, and asking it should not require a run.
export function collectBlockers(workflow: Workflow): Blocker[] {
    const blockers: Blocker[] = [];

    // Tolerant of a half-built graph: this is called while a workflow is still
    // being assembled, and reporting a malformed one is validateWorkflow's job.
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];

    for (const node of nodes) {
        const params = node?.params;

        if (!params || typeof params !== 'object') continue;

        for (const [param, value] of Object.entries(params)) {
            if (value?.kind !== 'placeholder') continue;

            blockers.push({
                nodeId: node.id,
                param,
                placeholder: value.placeholder,
            });
        }
    }

    return blockers;
}

// The gate a run has to pass before anything is executed or written down.
//
// Both refusals are collected in one pass rather than short-circuiting on the
// first, so someone repairing a workflow sees everything wrong with it at once
// instead of fixing a broken edge only to be told about a missing channel.
//
// Only validation *errors* refuse a run. Warnings are observations — including the
// UNRESOLVED_PLACEHOLDER one, which the blockers already cover in a usable form.
export function preflight(workflow: Workflow): PreflightResult {
    const validation = validateWorkflow(workflow);
    const blockers = collectBlockers(workflow);

    return {
        ok: validation.errors.length === 0 && blockers.length === 0,
        validationErrors: validation.errors,
        blockers,
    };
}
