import { describe, expect, test } from 'vitest';
import { action } from '../src';
import { zodFile } from '../src/zod-file';

describe.only('action form data', () => {
	const uploadFile = action()
		.input({
			file: zodFile({ type: '123' }),
		})
		.mutation(async ({ input, ctx }) => {
			return { input, ctx };
		});

	test('should accept audio file', async () => {
		const file = new Blob([], { type: '123' });
		const result = await uploadFile({ file });
		expect(result.input.file.type).toBe('123');
	});
});
