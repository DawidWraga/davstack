import { expect, test } from 'vitest';
import { sum } from '../src';

test('sound', () => {
	const result = sum(1, 2);

	expect(result).toBe(3);
});
