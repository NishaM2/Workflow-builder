import { describe, expect, it } from 'vitest';
import { CATALOG } from '@flow/core';
import { EXECUTORS } from './index';

describe('executor registry', () => {
    it('has an executor for every catalog node', () => {
        expect(Object.keys(EXECUTORS).sort())
        .toEqual(Object.keys(CATALOG).sort());
    });
});