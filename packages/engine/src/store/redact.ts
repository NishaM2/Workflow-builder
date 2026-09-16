import type { WorkflowNode } from '@flow/core';
import type { StepRecord } from '../types';

export const REDACTED = 'REDACTED';

// Names that carry credentials. Matched against header names, query parameter names
// and the keys of a parsed query map.
const CREDENTIAL_NAME = /authorization|api[-_]?key|token|secret|cookie/i;

// Keys holding name/value maps, where a name alone is enough to mark a credential.
const CREDENTIAL_MAPS = new Set(['headers', 'query']);

interface WalkContext {
    // Somewhere below a headers or query key: credential-named keys are masked.
    inMap: boolean;
    // Somewhere below a url key: strings are URLs whose credentials are masked.
    inUrl: boolean;
}

// Returns a copy of value with its credentials masked, for anything about to be
// persisted. Masked: credential-named keys anywhere below a `headers` or `query` key
// (at any depth, so a header map wrapped in a snapshot's ParameterValue is covered),
// and credential-named query parameters and userinfo in any string below a `url` key.
// Bodies are left alone, since key names there are too noisy a signal.
export function redactValue<T>(value: T): T {
    return walk(value, { inMap: false, inUrl: false }) as T;
}

// A step fit to persist: credentials masked in its resolved params and its output,
// and any param the graph marks as an api_key placeholder masked whole.
export function redactStep(step: StepRecord, node: WorkflowNode | undefined): StepRecord {
    const apiKeys = apiKeyParams(node);

    const resolvedParams =
        step.resolvedParams &&
        Object.fromEntries(
            Object.entries(step.resolvedParams).map(([name, value]) => [
                name,
                apiKeys.has(name) ? REDACTED : value,
            ]),
        );

    return {
        ...step,
        resolvedParams: redactValue(resolvedParams),
        output: redactValue(step.output),
    };
}

// Params the graph marks as api_key placeholders. Today filling in a placeholder
// replaces it with a literal and loses the type, so this only starts protecting
// anything once the fill-in flow keeps that information.
function apiKeyParams(node: WorkflowNode | undefined): Set<string> {
    const names = new Set<string>();

    for (const [name, param] of Object.entries(node?.params ?? {})) {
        if (param.kind === 'placeholder' && param.placeholder.type === 'api_key') {
            names.add(name);
        }
    }

    return names;
}

function walk(value: unknown, context: WalkContext): unknown {
    if (typeof value === 'string') {
        return context.inUrl ? redactUrl(value) : value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => walk(item, context));
    }

    if (!isPlainObject(value)) return value;

    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
            if (context.inMap && CREDENTIAL_NAME.test(key)) return [key, REDACTED];

            const name = key.toLowerCase();

            return [
                key,
                walk(item, {
                    inMap: context.inMap || CREDENTIAL_MAPS.has(name),
                    inUrl: context.inUrl || name === 'url',
                }),
            ];
        }),
    );
}

function redactUrl(raw: string): string {
    let url: URL;

    try {
        url = new URL(raw);
    } catch {
        // Not a URL at all: a template, a relative path, a ParameterValue's kind.
        return raw;
    }

    let changed = false;

    for (const name of new Set(url.searchParams.keys())) {
        if (CREDENTIAL_NAME.test(name)) {
            url.searchParams.set(name, REDACTED);
            changed = true;
        }
    }

    // https://user:pass@host, and a token passed as the username, are credentials too.
    if (url.username) {
        url.username = REDACTED;
        changed = true;
    }

    if (url.password) {
        url.password = REDACTED;
        changed = true;
    }

    // An untouched URL goes back exactly as it came, not re-serialised.
    return changed ? url.toString() : raw;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
}
