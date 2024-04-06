import { describe, expect, it, test } from 'vitest';
import { flattenObject } from '../src/utils/flatten-object';

import { expectTypeOf } from 'vitest';

describe('flattenObject', () => {
	it('should handle an object with no nested properties', () => {
		const obj = {
			a: 'value1',
			b: 'value2',
		};

		const result = flattenObject(obj);

		expect(result).toEqual({
			a: 'value1',
			b: 'value2',
		});

		// Type assertions using expectTypeOf
		expectTypeOf(result).toEqualTypeOf<{
			a: string;
			b: string;
		}>();
	});

	it('should flatten an object recursively without overriding parents by default', () => {
		const obj = {
			a: 'value1',
			b: {
				c: 'value2',
				d: {
					e: 'value3',
				},
			},
		};

		const result = flattenObject(obj);

		expectTypeOf(result).toEqualTypeOf<{
			a: string;
			b: { c: string; d: { e: string } };

			'b.c': string;
			'b.d': { e: string };
			'b.d.e': string;
		}>();
	});

	test('should overwrite nested properties if overwrite option is true', () => {
		const obj = {
			a: 'value1',
			b: {
				c: 'value2',
				d: {
					e: 'value3',
				},
			},
		};

		const result = flattenObject(obj, { overwrite: true });

		expect(result).toStrictEqual({
			a: 'value1',
			'b.c': 'value2',
			'b.d.e': 'value3', // nested properties have been flattened
		});

		expectTypeOf(result).toEqualTypeOf<{
			a: string;
			'b.c': string;
			'b.d.e': string;
		}>();
	});
	it('should overwrite nested properties if overwrite option is true v2', () => {
		const obj = {
			a: {
				b: {
					c: 'value1',
				},
			},
		};
		const result = flattenObject(obj, { overwrite: true });

		expect(result).toStrictEqual({
			'a.b.c': 'value1',
		});

		// Type assertions using expectTypeOf
		expectTypeOf(result).toEqualTypeOf<{
			'a.b.c': string;
		}>();
	});
});
