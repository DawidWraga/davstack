import { z } from 'zod';

type FileType =
	| 'audio/*'
	| 'video/*'
	| 'application/*'
	| 'image/*'
	| 'text/*'
	| string[]
	| (string & {});

export interface ZodFileOptions {
	type: FileType;
	maxSizeMb?: number;
}

export interface ZodFile {
	_type?: 'ZodFile/Buffer' | 'ZodFile/Blob' | 'ZodFile/File';
	lastModified?: number;
	name?: string;
	size: number;
	type: string;
	arrayBuffer: () => Promise<ArrayBuffer>;
	stream: () => any;
	text: () => Promise<string>;
}

const MB = 1024 * 1024;

export function zodFile(options: ZodFileOptions): z.ZodType<ZodFile> {
	const { type, maxSizeMb = 10 } = options;
	let receivedType = '';

	return z
		.any()
		.refine(
			(file): file is File | Blob | Buffer =>
				file instanceof File || file instanceof Blob || Buffer.isBuffer(file),
			{ message: 'Invalid file provided.' }
		)
		.transform((file) => {
			if (file instanceof File) {
				return {
					_type: 'ZodFile/File' as const,
					lastModified: file.lastModified,
					name: file.name,
					size: file.size,
					type: file.type,
					arrayBuffer: () => file.arrayBuffer(),
					stream: () => file.stream(),
					text: () => file.text(),
				};
			}
			if (file instanceof Blob) {
				return {
					_type: 'ZodFile/Blob' as const,
					lastModified: 0,
					name: '',
					size: file.size,
					type: file.type,
					arrayBuffer: () => file.arrayBuffer(),
					stream: () => {
						throw new Error('Streaming not supported for Blob');
					},
					text: () => file.text(),
				};
			}
			if (Buffer.isBuffer(file)) {
				return {
					_type: 'ZodFile/Buffer' as const,
					lastModified: 0,
					name: '',
					size: file.length,
					type: (file as any).type ?? '',
					arrayBuffer: () => Promise.resolve(file.buffer),
					stream: () => {
						throw new Error('Streaming not supported for Buffer');
					},
					text: () => Promise.resolve(file.toString()),
				};
			}
			throw new Error('Unexpected file type');
		})
		.refine(
			(file) => {
				if (type === '*') return true;
				const acceptedTypes = getAcceptedFileTypes(type);
				const isAccepted = acceptedTypes.some((acceptedType) =>
					file.type.startsWith(acceptedType.replace('*', ''))
				);
				if (!isAccepted) receivedType = file.type;
				return isAccepted;
			},
			(file) => ({
				message: `Only ${getFileTypeString(
					type
				)} files are accepted. Received: ${receivedType || file.type}`,
			})
		)
		.refine((file) => file.size <= maxSizeMb * MB, {
			message: `File size exceeds the limit of ${maxSizeMb} MB.`,
		});
}

function getAcceptedFileTypes(type: FileType): string[] {
	if (Array.isArray(type)) return type;
	return [type];
}

function getFileTypeString(type: FileType): string {
	const acceptedTypes = getAcceptedFileTypes(type);
	if (acceptedTypes.length === 0) return 'NO FILE TYPES ARE ACCEPTED.';
	if (acceptedTypes.length === 1) return acceptedTypes[0]!;
	return acceptedTypes.join(', ');
}
