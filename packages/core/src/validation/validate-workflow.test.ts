import { describe, expect, it } from 'vitest'

import { validateWorkflow } from './validate-workflow'
import { topoSort } from './validate-workflow'
import validWorkflow from '../fixtures/valid.json'
import brokenObvious from '../fixtures/broken-obvious.json'
import brokenSubtle from '../fixtures/broken-subtle.json'
import cycleWorkflow from '../fixtures/cycle.json'
import validIfWorkflow from '../fixtures/valid-if.json'
import invalidIfPortWorkflow from '../fixtures/invalid-if-port.json'

describe('validateWorkflow', () => {
    const minimal = (
    nodes: unknown[],
    edges: unknown[] = [],
    ) => ({
        id: 'w',
        name: 'test',
        version: 1,
        nodes,
        edges,
    });

    it('accepts a valid workflow with a placeholder warning', () => {
        const result = validateWorkflow(validWorkflow)
        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
        expect(result.warnings).toHaveLength(1)
        expect(result.warnings[0]?.code,).toBe('UNRESOLVED_PLACEHOLDER')
    })

    it('collects multiple errors instead of failing fast', () => {
        const result = validateWorkflow(brokenObvious)
        expect(result.valid).toBe(false)

        const codes =
        result.errors.map(
            (error) => error.code,
        )

        expect(codes).toContain(
            'UNKNOWN_NODE_TYPE',
        )

        expect(codes).toContain(
            'MISSING_PARAM',
        )

        expect(codes).toContain(
            'MISSING_TRIGGER',
        )

        expect(codes).toContain(
            'UNKNOWN_NODE',
        )
    })

    it('detects an invalid output reference', () => {
        const result = validateWorkflow(brokenSubtle);
        expect(result.valid).toBe(false);

        const codes =
        result.errors.map(
            (error) => error.code,
        )

        expect(codes).toContain(
            'INVALID_REFERENCE',
        )
    })

    it('detects cycles', () => {
        const result = validateWorkflow(cycleWorkflow)
        expect(result.valid).toBe(false);

        const codes =
        result.errors.map(
            (error) => error.code,
        )

        expect(codes).toContain(
            'CYCLE_DETECTED',
        )
    })

    it('accepts valid if-node output ports', () => {
        const result = validateWorkflow(validIfWorkflow);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    })

    it('rejects an invalid output port', () => {
        const result = validateWorkflow(invalidIfPortWorkflow);

        expect(result.valid).toBe(false);

        const codes = result.errors.map((error) => error.code);

        expect(codes).toContain('INVALID_EDGE');
    })

    it('rejects an invalid type version', () => {
        const result = validateWorkflow(
            minimal([
                {
                    id: 'manual_1',
                    type: 'manual.trigger',
                    typeVersion: 99,
                    params: {},
                    position: { x: 0, y: 0 },
                },
            ]),
        )

        expect(
            result.errors.map((error) => error.code),
        ).toContain('INVALID_TYPE_VERSION');
    })

    it('rejects multiple triggers', () => {
        const result = validateWorkflow(
            minimal([
                {
                    id: 'manual_1',
                    type: 'manual.trigger',
                    typeVersion: 1,
                    params: {},
                    position: { x: 0, y: 0 },
                },
                {
                    id: 'manual_2',
                    type: 'manual.trigger',
                    typeVersion: 1,
                    params: {},
                    position: { x: 200, y: 0 },
                },
            ]),
        )

        expect(
            result.errors.map((error) => error.code),
        ).toContain('MULTIPLE_TRIGGERS');
    })

   it('rejects a trigger with an incoming edge', () => {
        const workflow = {
            id: 'w',
            name: 'trigger incoming',
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
                    params: {
                        url: {
                            kind: 'literal',
                            value: 'https://example.com',
                        },
                        method: {
                            kind: 'literal',
                            value: 'GET',
                        },
                    },
                    position: { x: 200, y: 0 },
                },
            ],
            edges: [
                {
                    id: 'edge_1',
                    from: 'http_1',
                    fromPort: 'main',
                    to: 'manual_1',
                },
            ],
        }

        const result = validateWorkflow(workflow);

        expect(
            result.errors.map((error) => error.code),
        ).toContain('TRIGGER_HAS_INCOMING_EDGE');
    })

    it('rejects an invalid parameter value', () => {
        const result = validateWorkflow(
            minimal([
                {
                    id: 'manual_1',
                    type: 'manual.trigger',
                    typeVersion: 1,
                    params: {
                        something: {
                            kind: 'literal',
                            value: 'unexpected',
                        },
                    },
                    position: { x: 0, y: 0 },
                },
            ]),
        )

        expect(
            result.errors.map((error) => error.code),
        ).toContain('INVALID_PARAM');
    })

    it('rejects an unreachable node', () => {
        const workflow = {
            id: 'w',
            name: 'unreachable',
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
                    params: {
                        url: {
                            kind: 'literal',
                            value: 'https://example.com',
                        },
                        method: {
                            kind: 'literal',
                            value: 'GET',
                        },
                    },
                    position: { x: 200, y: 0 },
                },
                {
                    id: 'orphan_1',
                    type: 'http.request',
                    typeVersion: 1,
                    params: {
                        url: {
                            kind: 'literal',
                            value: 'https://example.com',
                        },
                        method: {
                            kind: 'literal',
                            value: 'GET',
                        },
                    },
                    position: { x: 500, y: 0 },
                },
            ],
            edges: [
                {
                    id: 'edge_1',
                    from: 'manual_1',
                    fromPort: 'main',
                    to: 'http_1',
                },
            ],
        }

        const result = validateWorkflow(workflow);

        expect(
            result.errors.map((error) => error.code),
        ).toContain('UNREACHABLE_NODE');
    })

    it('rejects an unknown parameter', () => {
        const workflow = {
            id: 'w',
            name: 'unknown param',
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
                    params: {
                        url: {
                            kind: 'literal',
                            value: 'https://example.com',
                        },
                        method: {
                            kind: 'literal',
                            value: 'GET',
                        },
                        unknownParam: {
                            kind: 'literal',
                            value: 'something',
                        },
                    },
                    position: { x: 200, y: 0 },
                },
            ],
            edges: [
                {
                    id: 'edge_1',
                    from: 'manual_1',
                    fromPort: 'main',
                    to: 'http_1',
                },
            ],
        }

        const result = validateWorkflow(workflow);

        expect(
            result.errors.map((error) => error.code),
        ).toContain('INVALID_PARAM');
    })
})


describe('topoSort', () => {
    it('returns nodes in dependency order', () => {
        const nodes = [
            { id: 'manual_1' },
            { id: 'http_1' },
            { id: 'llm_1' },
            { id: 'slack_1' },
        ]

        const edges = [
            {
                id: 'edge_1',
                from: 'manual_1',
                fromPort: 'main',
                to: 'http_1',
            },
            {
                id: 'edge_2',
                from: 'http_1',
                fromPort: 'main',
                to: 'llm_1',
            },
            {
                id: 'edge_3',
                from: 'llm_1',
                fromPort: 'main',
                to: 'slack_1',
            },
        ]

        const order = topoSort(nodes, edges);

        expect(order.indexOf('manual_1')).toBeLessThan(
            order.indexOf('http_1'),
        )

        expect(order.indexOf('http_1')).toBeLessThan(
            order.indexOf('llm_1'),
        )

        expect(order.indexOf('llm_1')).toBeLessThan(
            order.indexOf('slack_1'),
        )
    })
})