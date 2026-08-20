import type { Workflow } from '@flow/core';
import type { EdgeState } from '../types/run-state';
import type { StepRecord } from '../types/step';

export class RunContext {
    private outputs: Map<string, unknown>;
    private steps: Map<string, StepRecord>;
    private edgeStates: Map<string, EdgeState>;

    private outgoingEdges: Map<string, Workflow['edges']>;
    private incomingEdges: Map<string, Workflow['edges']>;

    constructor(workflow: Workflow) {
        this.outputs = new Map();
        this.steps = new Map();
        this.edgeStates = new Map();

        this.outgoingEdges = new Map();
        this.incomingEdges = new Map();

        // Index edges once so we don't scan the workflow repeatedly.
        for (const edge of workflow.edges) {
            this.edgeStates.set(edge.id, 'pending');

            const outgoing = this.outgoingEdges.get(edge.from) ?? [];
            outgoing.push(edge);
            this.outgoingEdges.set(edge.from, outgoing);

            const incoming = this.incomingEdges.get(edge.to) ?? [];
            incoming.push(edge);
            this.incomingEdges.set(edge.to, incoming);
        }
    }

    // Record a successful node execution. A successful node gets an output. Its fired ports determine which outgoing edges become active. All other outgoing edges become dead.
    recordSuccess(step: StepRecord): void {
        const successStep: StepRecord = {
            ...step,
            state: 'success'
        };

        this.outputs.set(successStep.nodeId, successStep.output);
        this.steps.set(successStep.nodeId, successStep);
        this.updateOutgoingEdges(successStep.nodeId, successStep.firedPorts);
    }

    // Record a node execution error. Errors do not produce usable outputs. All outgoing edges become dead.
    recordError(step: StepRecord): void {
        const errorStep: StepRecord = {
            ...step,
            state: 'error',
        };

        // Make sure a failed node never has an output.
        this.outputs.delete(errorStep.nodeId);

        this.steps.set(
            errorStep.nodeId,
            errorStep
        );

        const outgoing =
            this.outgoingEdges.get(errorStep.nodeId) ?? [];

        for (const edge of outgoing) {
            this.edgeStates.set(edge.id, 'dead');
        }
    }

    // Record a node that was skipped because its branch was not taken. A skipped node never gets an output
    recordSkipped(step: StepRecord): void {
        const skippedStep: StepRecord = {
            ...step,
            state: 'skipped',
        };

        this.outputs.delete(skippedStep.nodeId);

        this.steps.set(
            skippedStep.nodeId,
            skippedStep
        );

        const outgoing =
            this.outgoingEdges.get(skippedStep.nodeId) ?? [];

        for (const edge of outgoing) {
            this.edgeStates.set(edge.id, 'dead');
        }
    }

    getOutput(nodeId: string): unknown {
        return this.outputs.get(nodeId);
    }

    // Read an output without allowing callers to mutate the internal map.
    getOutputs(): ReadonlyMap<string, unknown> {
        return this.outputs;
    }

    // Read one node's step record.
    getStep(nodeId: string): StepRecord | undefined {
        return this.steps.get(nodeId);
    }

    
    // Get the state of one edge.
    getEdgeState(edgeId: string): EdgeState {
        return this.edgeStates.get(edgeId) ?? 'pending';
    }

    // Read all edge states.
    getEdgeStates(): ReadonlyMap<string, EdgeState> {
        return this.edgeStates;
    }

    // Does this node have any incoming edges? This lets the engine distinguish a root/trigger node from a node whose incoming edges are simply all dead.
    hasIncomingEdges(nodeId: string): boolean {
        return (
            (this.incomingEdges.get(nodeId) ?? []).length > 0
        );
    }

    // Is at least one incoming edge active?
    hasActiveIncomingEdge(nodeId: string): boolean {
        const incoming =
            this.incomingEdges.get(nodeId) ?? [];

        return incoming.some(
            (edge) =>
                this.edgeStates.get(edge.id) === 'active'
        );
    }

    // Return all recorded steps.
    getSteps(): StepRecord[] {
        return Array.from(this.steps.values());
    }

    // Mark outgoing edges according to the ports fired by a successful node.
    private updateOutgoingEdges(
        nodeId: string,
        firedPorts: string[]
    ): void {
        const outgoing =
            this.outgoingEdges.get(nodeId) ?? [];

        const fired = new Set(firedPorts);

        for (const edge of outgoing) {
            if (fired.has(edge.fromPort)) {
                this.edgeStates.set(edge.id, 'active');
            } else {
                this.edgeStates.set(edge.id, 'dead');
            }
        }
    }
}