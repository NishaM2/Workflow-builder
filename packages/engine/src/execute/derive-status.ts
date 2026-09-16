import type { StepRecord, TerminalRunStatus } from '../types';

// What a run that actually walked can end as. 'blocked' is the gate's verdict on a
// run that never started, so it is unreachable from steps: a blocked run has none.
export type ExecutedRunStatus = Exclude<TerminalRunStatus, 'blocked'>;

// One failed node makes the whole run a failure, whatever onError said.
//
// onError: 'continue' is about the walk, not the verdict. It keeps independent
// branches running so one run tells you about every failure instead of one per
// re-run; it does not make the failure acceptable. There is deliberately no
// 'partial' — a run either did what the graph asked or it did not, and every caller
// forced to decide what "mostly worked" means would decide it differently.
//
// Skipped and pending nodes say nothing here. A skipped node is a branch the graph
// chose against, which is the IF node working as designed. A pending one is a node
// the run never reached, and whatever stopped the run is already recorded as an
// error of its own.
export function deriveStatus(steps: readonly StepRecord[]): ExecutedRunStatus {
    return steps.some((step) => step.state === 'error') ? 'error' : 'success';
}

// Which node gets named when several failed: the first one the walk recorded.
//
// Under 'stop' there is only ever one. Under 'continue' the later failures are
// usually consequences of the earlier — a branch losing its input, a template
// pointing at an output that never arrived — so the earliest is the one worth
// surfacing. The rest are in the steps for anyone who wants them.
export function firstFailedStep(
    steps: readonly StepRecord[],
): StepRecord | undefined {
    return steps.find((step) => step.state === 'error');
}
