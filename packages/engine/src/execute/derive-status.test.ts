import { describe, expect, it } from 'vitest';
import type { NodeState, StepRecord } from '../types';
import { deriveStatus, firstFailedStep } from './derive-status';

const step = (nodeId: string, state: NodeState): StepRecord => ({
    nodeId,
    state,
    firedPorts: [],
    startedAt: '1970-01-01T00:00:00.000Z',
    finishedAt: '1970-01-01T00:00:00.000Z',
    durationMs: 0,
    attempt: state === 'success' || state === 'error' ? 1 : 0,
    error: state === 'error' ? { message: `${nodeId} failed` } : undefined,
});

describe('deriveStatus', () => {
    it('is success when every node succeeded', () => {
        expect(deriveStatus([step('a', 'success'), step('b', 'success')])).toBe(
            'success',
        );
    });

    it('is success for a run with no steps at all', () => {
        expect(deriveStatus([])).toBe('success');
    });

    it('is error when any node failed', () => {
        expect(deriveStatus([step('a', 'success'), step('b', 'error')])).toBe(
            'error',
        );
    });

    // The decision this module exists for.
    it('is error even when the run walked past the failure', () => {
        const steps = [
            step('a', 'error'),
            step('b', 'skipped'),
            step('c', 'success'),
        ];

        expect(deriveStatus(steps)).toBe('error');
    });

    it('is success when nodes were only skipped', () => {
        expect(deriveStatus([step('a', 'success'), step('b', 'skipped')])).toBe(
            'success',
        );
    });

    // Pending means "never reached". Something else is the failure.
    it('is success when nodes were only left pending', () => {
        expect(deriveStatus([step('a', 'success'), step('b', 'pending')])).toBe(
            'success',
        );
    });
});

describe('firstFailedStep', () => {
    it('finds nothing when nothing failed', () => {
        expect(firstFailedStep([step('a', 'success')])).toBeUndefined();
    });

    it('names the earliest failure when several failed', () => {
        const steps = [
            step('a', 'success'),
            step('b', 'error'),
            step('c', 'error'),
        ];

        expect(firstFailedStep(steps)?.nodeId).toBe('b');
    });
});
