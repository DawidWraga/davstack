/**
 * Standardized error codes for Fn operations
 */
export const FnErrorCode = {
	BAD_REQUEST: 'BAD_REQUEST',
	UNAUTHORIZED: 'UNAUTHORIZED',
	FORBIDDEN: 'FORBIDDEN',
	NOT_FOUND: 'NOT_FOUND',
	METHOD_NOT_SUPPORTED: 'METHOD_NOT_SUPPORTED',
	TIMEOUT: 'TIMEOUT',
	CONFLICT: 'CONFLICT',
	PRECONDITION_FAILED: 'PRECONDITION_FAILED',
	PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
	UNPROCESSABLE_CONTENT: 'UNPROCESSABLE_CONTENT',
	TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
	CLIENT_CLOSED_REQUEST: 'CLIENT_CLOSED_REQUEST',
	INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
	NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
	BAD_GATEWAY: 'BAD_GATEWAY',
	SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
	GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
	INVALID_INPUT: 'INVALID_INPUT',
	INVALID_OUTPUT: 'INVALID_OUTPUT',
} as const;

export type FnErrorCodeType = keyof typeof FnErrorCode;

/**
 * Options for creating a new FnError
 */
export interface FnErrorOptions {
	code: FnErrorCodeType;
	message?: string;
	cause?: Error;
	meta?: Record<string, unknown>;
}

/**
 * Checks if an object is a plain object (not null, not array)
 */
function isObject(obj: unknown): obj is Record<string, unknown> {
	return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Gets a message from an unknown error
 */
function getMessageFromUnknownError(err: unknown, fallback: string): string {
	if (typeof err === 'string') {
		return err;
	}
	if (isObject(err) && typeof err['message'] === 'string') {
		return err['message'];
	}
	return fallback;
}

/**
 * Custom error class for Fn operations
 */
export class FnError extends Error {
	readonly code: FnErrorCodeType;
	readonly cause?: Error;
	readonly _reported?: boolean;
	readonly meta: Record<string, unknown>;

	constructor(opts: FnErrorOptions) {
		// Use custom message or default based on the error code
		const message = opts.message || getDefaultErrorMessage(opts.code);
		super(message);

		this.name = 'FnError';
		this.code = opts.code;
		this.cause = opts.cause;
		this.meta = opts.meta || {};

		// Set prototype explicitly since TypeScript classes lose their prototype chain when extended
		Object.setPrototypeOf(this, FnError.prototype);
	}

	/**
	 * Mark the error as reported to prevent duplicate logging
	 */
	markAsReported(): this {
		Object.defineProperty(this, '_reported', { value: true });
		return this;
	}

	/**
	 * Creates an FnError from any error or object
	 */
	static from(
		cause: unknown,
		opts: {
			code?: FnErrorCodeType;
			message?: string;
			meta?: Record<string, unknown>;
		} = {}
	): FnError {
		// If it's already an FnError, just enhance it without creating a new one
		if (isFnError(cause)) {
			if (opts.meta) {
				// Merge the meta data without losing existing data
				Object.assign(cause.meta, opts.meta);
			}
			return cause;
		}

		// Create a new FnError that references the original cause
		return new FnError({
			code: opts.code || 'INTERNAL_SERVER_ERROR',
			message:
				opts.message || getMessageFromUnknownError(cause, 'Unknown error'),
			cause: cause instanceof Error ? cause : undefined,
			meta: opts.meta || {},
		});
	}
}

/**
 * Gets a default error message for a given error code
 */
function getDefaultErrorMessage(code: FnErrorCodeType): string {
	switch (code) {
		case 'BAD_REQUEST':
			return 'Invalid request';
		case 'UNAUTHORIZED':
			return 'Not authenticated';
		case 'FORBIDDEN':
			return 'Not authorized';
		case 'NOT_FOUND':
			return 'Resource not found';
		case 'INTERNAL_SERVER_ERROR':
			return 'An unexpected error occurred';
		case 'CONFLICT':
			return 'Resource conflict';
		case 'TIMEOUT':
			return 'Operation timed out';
		case 'INVALID_INPUT':
			return 'Invalid input data';
		case 'INVALID_OUTPUT':
			return 'Invalid output data';
		// Add default messages for all codes
		default:
			return `Error: ${code}`;
	}
}

/**
 * Type guard to check if an error is an FnError
 */
export function isFnError(error: unknown): error is FnError {
	return error instanceof FnError;
}
