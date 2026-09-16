import { describe, expect, it } from 'vitest';
import type { Workflow } from '@flow/core';
import type { RunStore, StartRunInput, StepRecord } from '../types';
import { InMemoryRunStore } from './in-memory-run-store';
import { REDACTED } from './redact';
import { redactingRunStore } from './redacting-run-store';
import { resilientRunStore } from './resilient-run-store';

const snapshot: Workflow = {
    id: 'w1',
    name: 'with secrets',
    version: 1,
    nodes: [
        {
            id: 'manual_1',
            type: 'manual.trigger',
            typeVersion: 1,
            params: {},
            position: { x: 0, y: 0 },
        },
        {
            id: 'http_1',
            type: 'http.request',
            typeVersion: 1,
            position: { x: 0, y: 0 },
            params: {
                url: { kind: 'literal', value: 'https://api.example.com/items' },
                method: { kind: 'literal', value: 'GET' },
                headers: {
                    kind: 'literal',
                    value: { Authorization: 'Bearer secret-token' },
                },
            },
        },
    ],
    edges: [{ id: 'e1', from: 'manual_1', fromPort: 'main', to: 'http_1' }],
};

const started: StartRunInput = {
    runId: 'run_1',
    workflowId: 'w1',
    workflowSnapshot: snapshot,
    triggerPayload: {
        headers: { authorization: 'Bearer inbound' },
        body: { hello: 'world' },
    },
    startedAt: '2026-01-01T00:00:00.000Z',
};

const httpStep: StepRecord = {
    nodeId: 'http_1',
    state: 'success',
    resolvedParams: {
        url: 'https://api.example.com/items',
        method: 'GET',
        headers: { Authorization: 'Bearer secret-token' },
    },
    output: {
        status: 200,
        headers: { 'set-cookie': 'session=1' },
        body: { ok: true },
    },
    firedPorts: ['main'],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.010Z',
    durationMs: 10,
    attempt: 1,
};

describe('InMemoryRunStore', () => {
    it('keeps a run and its steps exactly as given', async () => {
        const store = new InMemoryRunStore();

        await store.startRun(started);
        await store.recordStep('run_1', httpStep);
        await store.finishRun({
            runId: 'run_1',
            status: 'success',
            finishedAt: '2026-01-01T00:00:01.000Z',
        });

        const run = store.getRun('run_1');
        expect(run?.status).toBe('success');
        expect(run?.finishedAt).toBe('2026-01-01T00:00:01.000Z');

        // Tests want the real values, so nothing is redacted in memory.
        expect(run?.steps).toEqual([httpStep]);
    });

    it('keeps one record per node, a later one replacing it', async () => {
        const store = new InMemoryRunStore();

        await store.startRun(started);
        await store.recordStep('run_1', { ...httpStep, state: 'running' });
        await store.recordStep('run_1', httpStep);

        expect(store.getRun('run_1')?.steps).toEqual([httpStep]);
    });

    it('rejects a step for a run that was never started, as the foreign key would', async () => {
        const store = new InMemoryRunStore();

        await expect(store.recordStep('missing', httpStep)).rejects.toThrow('missing');
    });
});

describe('redactingRunStore', () => {
    it('masks credentials before anything reaches the store it wraps', async () => {
        const inner = new InMemoryRunStore();
        const store = redactingRunStore(inner);

        await store.startRun(started);
        await store.recordStep('run_1', httpStep);

        const run = inner.getRun('run_1')!;

        expect(run.workflowSnapshot.nodes[1]?.params.headers).toEqual({
            kind: 'literal',
            value: { Authorization: REDACTED },
        });
        expect(run.triggerPayload).toEqual({
            headers: { authorization: REDACTED },
            body: { hello: 'world' },
        });
        expect(run.steps[0]?.resolvedParams?.headers).toEqual({ Authorization: REDACTED });
        expect(run.steps[0]?.output).toEqual({
            status: 200,
            headers: { 'set-cookie': REDACTED },
            body: { ok: true },
        });

        // The caller's own objects still hold the real values.
        expect(httpStep.resolvedParams?.headers).toEqual({
            Authorization: 'Bearer secret-token',
        });
        expect(snapshot.nodes[1]?.params.headers).toEqual({
            kind: 'literal',
            value: { Authorization: 'Bearer secret-token' },
        });
    });

    it('caps an oversized output', async () => {
        const inner = new InMemoryRunStore();
        const store = redactingRunStore(inner);

        await store.startRun(started);
        await store.recordStep('run_1', {
            ...httpStep,
            output: { body: 'x'.repeat(300 * 1024) },
        });

        expect(inner.getRun('run_1')?.steps[0]?.output).toMatchObject({
            __truncated: true,
        });
    });
});

describe('resilientRunStore', () => {
    const failing: RunStore = {
        startRun: async () => {
            throw new Error('connection reset');
        },
        recordStep: async () => {
            throw new Error('connection reset');
        },
        finishRun: async () => {
            throw new Error('connection reset');
        },
    };

    it('logs a failed write and lets the run carry on', async () => {
        const logged: Array<[string, Record<string, unknown> | undefined]> = [];

        const store = resilientRunStore(failing, {
            info() {},
            error: (message, meta) => {
                logged.push([message, meta]);
            },
        });

        await expect(store.startRun(started)).resolves.toBeUndefined();
        await expect(store.recordStep('run_1', httpStep)).resolves.toBeUndefined();
        await expect(
            store.finishRun({
                runId: 'run_1',
                status: 'error',
                finishedAt: '2026-01-01T00:00:01.000Z',
            }),
        ).resolves.toBeUndefined();

        expect(logged).toHaveLength(3);
        expect(logged[1]).toEqual([
            expect.stringContaining('recordStep'),
            { runId: 'run_1', error: 'connection reset' },
        ]);
    });

    it('survives a logger that throws as well', async () => {
        const store = resilientRunStore(failing, {
            info() {},
            error() {
                throw new Error('logger down');
            },
        });

        await expect(store.recordStep('run_1', httpStep)).resolves.toBeUndefined();
    });
});
