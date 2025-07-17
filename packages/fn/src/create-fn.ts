/* eslint-disable no-unused-vars */
import { ZodTypeAny } from 'zod';
import { FnError } from './errors';
import { Simplify, zInferInput } from './utils/type-utils';
import { redactSensitive } from './utils/zod-sensitive';

// #region --- Type Definitions ---

/**
 * The core handler function's signature, generic over schemas for inference.
 */
export type FnHandler<
	TContext extends Record<string, any> | unknown = unknown,
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutput = any,
> = (args: {
	input: TInputSchema extends ZodTypeAny ? zInferInput<TInputSchema> : null;
	ctx: Simplify<TContext>;
}) => Promise<TOutput>;

/**
 * The definition object for creating a function. This is the primary input for `createFn`.
 */
export type FnDef<
	TContext extends Record<string, any> | unknown = unknown,
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown = undefined,
	THandler extends FnHandler<TContext, TInputSchema, any> = FnHandler<
		TContext,
		TInputSchema,
		any
	>,
> = {
	name: string;
	description?: string;
	tags?: string[];
	inputSchema?: TInputSchema;
	outputSchema?: TOutputSchema;
	handler: THandler;
	middleware?: Middleware<TContext>[];
};

/**
 * The standard result wrapper for safe calls.
 */
export type Result<T> =
	| { data: T; error: null }
	| { data: null; error: FnError | Error };

/**
 * Helper type for function arguments with optional input and context.
 * This allows for calling functions with `myFn()` or `myFn({ ctx })`
 * instead of requiring `myFn({ input: undefined, ctx: undefined })`.
 */
export type FnArgs<TInput, TContext> = Simplify<
	(void extends TInput ? { input?: TInput } : { input: TInput }) &
		(unknown extends TContext ? { ctx?: TContext } : { ctx: TContext })
>;

/**
 * The main, user-facing Function type.
 * It is generic over the clean data types for a better developer experience.
 */
export type Fn<TContext = unknown, TInput = void, TOutput = any> = Omit<
	FnDef<any, any, any, any>,
	'handler' | 'middleware'
> & {
	handler: FnHandler<any, any, any>;
	middleware?: Middleware<TContext>[];
	safeCall: (args: FnArgs<TInput, TContext>) => Promise<Result<TOutput>>;
} & ((args: FnArgs<TInput, TContext>) => Promise<TOutput>);

// #endregion

// #region --- Middleware System ---

export type Middleware<
	TContext extends Record<string, any> | unknown = unknown,
	TNewContext extends Record<string, any> | unknown = TContext,
> = (opts: {
	ctx: TContext;
	input: any;
	def: FnDef<any, any, any, any>;
	next: (ctx?: TNewContext) => Promise<any>;
}) => Promise<any>;

/**
 * Helper to create properly typed middleware.
 */
export function createMiddleware<
	TContext extends Record<string, any> | unknown = unknown,
	TNewContext extends Record<string, any> | unknown = TContext,
>(
	middlewareFn: Middleware<TContext, TNewContext>
): Middleware<TContext, TNewContext> {
	return middlewareFn;
}

/**
 * Executes a chain of middleware and the final handler.
 */
async function executeMiddleware<T>(opts: {
	def: FnDef<any, any, any, any>;
	args: FnArgs<any, any>;
}): Promise<T> {
	const { def, args } = opts;
	let index = 0;

	async function next(newCtx: any = args.ctx): Promise<T> {
		if (index >= (def.middleware?.length ?? 0)) {
			// Pass the potentially modified context to the final handler
			return def.handler({ input: args.input, ctx: newCtx });
		}

		const middleware = def.middleware?.[index++]!;
		return middleware({
			ctx: newCtx,
			input: args.input,
			def,
			next,
		});
	}

	return next(args.ctx);
}

function enhanceError(
	error: unknown,
	def: FnDef<any, any, any, any>,
	input: unknown
): FnError {
	if (error instanceof FnError) {
		error.meta.functionName = def.name;
		return error;
	}
	return FnError.from(error, {
		meta: {
			functionName: def.name,
			input: redactSensitive(input, def.inputSchema),
		},
	});
}

// #endregion

// #region --- Built-in Middleware ---

/**
 * Normalizes the args object to always have `input` and `ctx`.
 */
const withDefaults = createMiddleware(({ ctx, input, next }) => {
	// The `next` call receives the normalized context.
	return next(ctx ?? {});
});

/**
 * Input validation middleware.
 */
const withInputValidation = createMiddleware(({ ctx, input, def, next }) => {
	const schema = def.inputSchema;
	if (!schema) return next(ctx);

	const result = schema.safeParse(input);
	if (!result.success) {
		throw new FnError({
			code: 'INVALID_INPUT',
			cause: result.error,
			meta: { zodErrors: result.error.flatten() },
		});
	}
	// The validated input is implicitly passed along.
	return next(ctx);
});

/**
 * Output validation middleware.
 */
const withOutputValidation = createMiddleware(
	async ({ ctx, input, def, next }) => {
		const schema = def.outputSchema;
		if (!schema) return next(ctx);

		const result = await next(ctx);
		const validationResult = (schema as any).safeParse(result);
		if (!validationResult.success) {
			throw new FnError({
				code: 'INVALID_OUTPUT',
				cause: validationResult.error,
				meta: { zodErrors: validationResult.error.flatten() },
			});
		}
		return validationResult.data;
	}
);

/**
 * Error handling middleware that enhances thrown errors.
 */
const withThrowingErrorHandler = createMiddleware(
	async ({ ctx, input, def, next }) => {
		try {
			return await next(ctx);
		} catch (error) {
			throw enhanceError(error, def, input);
		}
	}
);

/**
 * Middleware that formats the final result into a { data, error } object.
 */
const withSafeResultFormatter = createMiddleware(
	async ({ ctx, input, def, next }) => {
		try {
			const data = await next(ctx);
			return { data, error: null };
		} catch (error) {
			return { data: null, error: error as FnError };
		}
	}
);

// #endregion

// #region --- createFn ---

/**
 * Creates a new function with middleware and validation capabilities.
 *
 * @param def The function definition, including schemas and the handler.
 * @returns A callable function with an attached `.safeCall` method.
 */
export function createFn<
	TContext extends Record<string, any> | unknown,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	THandler extends FnHandler<TContext, TInputSchema, any>,
>(
	def: FnDef<TContext, TInputSchema, TOutputSchema, THandler>
): Fn<
	TContext,
	TInputSchema extends ZodTypeAny ? zInferInput<TInputSchema> : void,
	Awaited<ReturnType<THandler>>
> {
	const getArgs = (args: any) => {
		const _args = args ?? {};
		const input = 'input' in _args ? _args.input : null;
		const ctx = 'ctx' in _args ? _args.ctx : {};
		return { input, ctx };
	};

	// The pipeline for the direct, throwing call.
	const callFn = async (args: any) => {
		const callMiddleware = [
			withDefaults,
			withThrowingErrorHandler,
			...(def.middleware || []),
		];

		return executeMiddleware({
			def: { ...def, middleware: callMiddleware },
			args: getArgs(args),
		});
	};

	// The pipeline for the non-throwing, safe call.
	const safeCall = async (args: any) => {
		const safeCallMiddleware = [
			withSafeResultFormatter, // 1. (Outer) Formats the final result.
			withThrowingErrorHandler, // 2. Catches and enhances any errors.
			withDefaults, // 3. Normalizes arguments.
			withInputValidation, // 4. Validates input schema.
			...(def.middleware || []), // 5. Executes user-defined middleware.
			withOutputValidation, // 6. (Inner) Validates output schema.
		];

		return executeMiddleware({
			def: { ...def, middleware: safeCallMiddleware },
			args: getArgs(args),
		});
	};

	const { name, ...defWithoutName } = def;
	const result = Object.assign(callFn, defWithoutName, { safeCall }) as Fn<
		TContext,
		TInputSchema extends ZodTypeAny ? zInferInput<TInputSchema> : void,
		Awaited<ReturnType<THandler>>
	>;

	Object.defineProperty(result, 'name', {
		value: def.name,
		configurable: true,
	});

	return result;
}

// #endregion
