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

		// If there's a cause with a stack trace, preserve it instead of creating our own
		if (this.cause instanceof Error && this.cause.stack) {
			// Just take our message and combine it with the original stack
			this.stack = `${this.name}: ${this.message}\n${this.cause.stack
				.split('\n')
				.slice(1)
				.join('\n')}`;
		} else if (Error.captureStackTrace) {
			// Only capture our own stack if we don't have a cause with a stack
			Error.captureStackTrace(this, FnError);
		}

		// Clean up the stack trace to remove framework noise
		if (this.stack) {
			this.stack = FnError.cleanStackTrace(this.stack);
		}

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

	/**
	 * Cleans a stack trace to remove framework noise
	 *
	 * @param stack The full error stack trace
	 * @returns A cleaner stack trace with framework noise removed
	 */
	static cleanStackTrace(stack: string): string {
		const lines = stack.split('\n');

		// Always keep the error message line
		const cleanedLines = [lines[0]];

		// Look for user code first (non-framework lines)
		const userCodeLines = [];
		const frameworkCutoffPatterns = [
			// These patterns indicate we're hitting framework code
			'node_modules/.pnpm/@trpc',
			'node_modules/@trpc',
			'webpack-internal:///(rsc)/../../packages/fn/dist/utils/init-procedure-factory',
			'webpack-internal:///(rsc)/../../packages/fn/dist/fn.js',
			'resolveMiddleware',
		];

		// Include all lines up to the first framework line
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];

			// Check if this line matches any framework pattern
			const isFrameworkLine = frameworkCutoffPatterns.some((pattern) =>
				line.includes(pattern)
			);

			if (isFrameworkLine) {
				// Stop processing when we hit framework code
				break;
			}

			// This is user code, so add it to our cleaned stack
			userCodeLines.push(line);
		}

		// Add user code lines to our result
		cleanedLines.push(...userCodeLines);

		// If we couldn't find any user code lines, just return the first 3 lines
		// (error + 2 frames) to avoid showing nothing
		if (userCodeLines.length === 0 && lines.length > 1) {
			cleanedLines.push(lines[1]);
			if (lines.length > 2) {
				cleanedLines.push(lines[2]);
			}
		}

		// Add an indicator that we've truncated the stack
		if (lines.length > cleanedLines.length) {
			cleanedLines.push('    ... (framework internals truncated)');
		}

		return cleanedLines.join('\n');
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
