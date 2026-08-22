import { z } from 'zod';
import { logicIf } from '@flow/core';
import type { Executor } from '../types';

type IfParams = z.infer<typeof logicIf.parameters>;

function compare(
  left: IfParams['left'],
  operator: IfParams['operator'],
  right: IfParams['right'],
): boolean {
  const leftNumber =
    typeof left === 'number'
      ? left
      : typeof left === 'string' && left.trim() !== ''
        ? Number(left)
        : NaN;

  const rightNumber =
    typeof right === 'number'
      ? right
      : typeof right === 'string' && right.trim() !== ''
        ? Number(right)
        : NaN;

  const bothNumbers =
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber);

  const a = bothNumbers ? leftNumber : String(left);
  const b = bothNumbers ? rightNumber : String(right);

  switch (operator) {
    case 'equals':
      return a === b;

    case 'not_equals':
      return a !== b;

    case 'greater_than':
      return a > b;

    case 'greater_than_or_equal':
      return a >= b;

    case 'less_than':
      return a < b;

    case 'less_than_or_equal':
      return a <= b;

    default: {
      const _exhaustive: never = operator;
      throw new Error(`Unknown operator: ${_exhaustive}`);
    }
  }
}

export const logicIfExecutor: Executor<IfParams> = async ({ params }) => {
  const result = compare(
    params.left,
    params.operator,
    params.right,
  );

  return {
    status: 'success',
    output: {},
    firedPorts: [result ? 'true' : 'false'],
  };
};