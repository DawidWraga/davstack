import { describe, expect, test } from 'vitest';
import { zodFile } from '../src/zod-file';

describe('zodFile', () => {
	test('should accept valid File', async () => {
		const file = new File(['file content'], 'file.txt', { type: 'text/plain' });
		const schema = zodFile({ type: 'text/plain' });
		const result = await schema.parseAsync(file);
		expect(result).toEqual({
			_type: 'ZodFile/File',
			lastModified: expect.any(Number),
			name: 'file.txt',
			size: file.size,
			type: 'text/plain',
			arrayBuffer: expect.any(Function),
			stream: expect.any(Function),
			text: expect.any(Function),
		});
	});

	test('should accept valid Blob', async () => {
		const blob = new Blob(['blob content'], {
			type: 'application/octet-stream',
		});
		const schema = zodFile({ type: 'application/octet-stream' });
		const result = await schema.parseAsync(blob);
		expect(result).toEqual({
			_type: 'ZodFile/Blob',
			lastModified: 0,
			name: '',
			size: blob.size,
			type: 'application/octet-stream',
			arrayBuffer: expect.any(Function),
			stream: expect.any(Function),
			text: expect.any(Function),
		});
	});

	test('should accept valid Buffer', async () => {
		const buffer = Buffer.from('buffer content');
		const schema = zodFile({ type: '*' });
		const result = await schema.parseAsync(buffer);
		expect(result).toEqual({
			_type: 'ZodFile/Buffer',
			lastModified: 0,
			name: '',
			size: buffer.length,
			type: '',
			arrayBuffer: expect.any(Function),
			stream: expect.any(Function),
			text: expect.any(Function),
		});
	});

	test('should reject invalid file type', async () => {
		const file = new File(['file content'], 'file.txt', { type: 'text/plain' });
		const schema = zodFile({ type: 'application/pdf' });
		await expect(schema.parseAsync(file)).rejects.toThrowError(
			'Only application/pdf files are accepted. Received: text/plain'
		);
	});

	test('should reject file exceeding max size', async () => {
		const file = new File(['large file content'], 'file.txt', {
			type: 'text/plain',
		});
		const schema = zodFile({ type: 'text/plain', maxSizeMb: 1 / 1_000_000 });
		await expect(schema.parseAsync(file)).rejects.toThrowError(
			'File size exceeds the limit of 0.000001 MB.'
		);
	});

	test('should reject invalid file', async () => {
		const schema = zodFile({ type: '*' });
		await expect(schema.parseAsync({})).rejects.toThrowError(
			'Invalid file provided.'
		);
	});

	test('should accept file with valid type but unknown extension', async () => {
		const file = new File(['file content'], 'file.xyz', { type: 'text/plain' });
		const schema = zodFile({ type: 'text/plain' });
		const result = await schema.parseAsync(file);
		expect(result.type).toBe('text/plain');
	});

	test('should accept any file type when type option is set to "*"', async () => {
		const file = new File(['file content'], 'file.txt', { type: 'text/plain' });
		const schema = zodFile({ type: '*' });
		const result = await schema.parseAsync(file);
		expect(result.type).toBe('text/plain');
	});

	test('should use default max size when maxSize option is not provided', async () => {
		const file = new File(['small file'], 'file.txt', { type: 'text/plain' });
		const schema = zodFile({ type: 'text/plain' });
		await expect(schema.parseAsync(file)).resolves.not.toThrowError();
	});

	test('should handle empty file', async () => {
		const file = new File([], 'empty.txt', { type: 'text/plain' });
		const schema = zodFile({ type: 'text/plain' });
		const result = await schema.parseAsync(file);
		expect(result.size).toBe(0);
	});

	test('should accept file with generic audio type', async () => {
		const file = new File(['audio content'], 'audio.wav', {
			type: 'audio/wav',
		});
		const schema = zodFile({ type: 'audio/*' });
		const result = await schema.parseAsync(file);
		expect(result.type).toBe('audio/wav');
	});

	test('should accept file with generic application type', async () => {
		const file = new File(['application content'], 'data.json', {
			type: 'application/json',
		});
		const schema = zodFile({ type: 'application/*' });
		const result = await schema.parseAsync(file);
		expect(result.type).toBe('application/json');
	});

	test('should reject file with mismatched generic type', async () => {
		const file = new File(['text content'], 'file.txt', {
			type: 'text/plain',
		});
		const schema = zodFile({ type: 'image/*' });
		await expect(schema.parseAsync(file)).rejects.toThrowError(
			'Only image/* files are accepted. Received: text/plain'
		);
	});
});
