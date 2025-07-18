/* eslint-disable no-unused-vars */
import { ZodTypeAny } from 'zod';
import { FnError } from './errors';
import { Simplify, zInfer, zInferInput } from './utils/type-utils';
import { redactSensitive } from './utils/zod-sensitive';

// Re-export FnError for convenience
export { FnError };

// #region --- Fn Types ---

type AnyObject = Record<string, any>;
type EmptyObject = Record<string, never>;

/**
 * The core handler function's signature, generic over schemas for inference.
 */
export type FnHandler<
	TInput = void,
	TOutput = void,
	TContext extends AnyObject = EmptyObject,
> = (args: { input: TInput; ctx: TContext }) => TOutput;

/**
 * The definition object for creating a function. This is the primary input for createFn.
 */
export type FnDef<
	TInput = void,
	TOutput = void,
	TContext extends AnyObject = EmptyObject,
> = {
	name: string;
	description?: string;
	tags?: string[];
	inputSchema?: ZodTypeAny;
	outputSchema?: ZodTypeAny;
	// The handler is typed generally here; createFn will enforce a more specific type.
	handler: FnHandler<TInput, TOutput, TContext>;
	// Middleware array is flexible to allow chaining context transformations.
	middleware?: Middleware<TContext>[];
};

/**
 * The standard result wrapper for safe calls.
 */
export type Result<T> =
	| { data: T; error: null }
	| { data: null; error: FnError | Error };

export type OptionallyRequiredField<
	K extends string,
	Condition,
	T extends Record<string, any>,
> = void extends Condition
	? Omit<T, K> & Partial<Pick<T, K>>
	: unknown extends Condition
		? Omit<T, K> & Partial<Pick<T, K>>
		: T;

/**
 * Helper type for function arguments with optional input and context.
 * This allows for calling functions with myFn() or myFn({ ctx })
 * instead of requiring myFn({ input: undefined, ctx: undefined }).
 */
export type FnArgs<
	TInput = void,
	TContext extends AnyObject = EmptyObject,
> = Simplify<
	OptionallyRequiredField<
		'input',
		TInput,
		OptionallyRequiredField<
			'ctx',
			TContext,
			{
				input: TInput;
				ctx: TContext;
			}
		>
	>
>;

/**
 * The main, user-facing Function type.
 * It is generic over the clean data types for a better developer experience.
 */
export type Fn<
	TInput = void,
	TOutput = void,
	TContext extends AnyObject = EmptyObject,
> = FnDef<TInput, TOutput, TContext> & {
	safeCall: (args: FnArgs<TInput, TContext>) => TOutput;
} & ((args: FnArgs<TInput, TContext>) => TOutput);

// #endregion

// #region --- Middleware  ---

export type Middleware<
	TContext extends AnyObject = EmptyObject,
	TNewContext extends AnyObject = TContext,
> = (opts: {
	ctx: TContext;
	input: unknown;
	def: FnDef<unknown, unknown, Record<string, unknown>>;
	next: (ctx?: TNewContext) => Promise<unknown> | unknown;
}) => Promise<unknown> | unknown;

/**
 * Helper to create properly typed middleware.
 */
export function createMiddleware<
	TContext extends AnyObject = EmptyObject,
	TNewContext extends AnyObject = TContext,
>(
	middlewareFn: Middleware<TContext, TNewContext>
): Middleware<TContext, TNewContext> {
	return middlewareFn;
}

/**
 * Executes a chain of middleware and the final handler.
 */
async function executeMiddleware<T>(opts: {
	def: UnknownFnDef;
	args: UnknownFnArgs;
}): Promise<T> {
	const { def, args } = opts;
	let index = 0;

	async function next(newCtx: any = args.ctx): Promise<T> {
		if (index >= (def.middleware?.length ?? 0)) {
			// Pass the potentially modified context to the final handler
			return def.handler({ input: args.input, ctx: newCtx }) as T;
		}

		const middleware = def.middleware?.[index++]!;
		return middleware({
			ctx: newCtx,
			input: args.input,
			def,
			next,
		}) as T;
	}

	return next(args.ctx);
}

type UnknownFnDef = FnDef<unknown, unknown, AnyObject>;
type UnknownFnArgs = FnArgs<unknown, AnyObject>;
type AnyFnDef = FnDef<any, any, AnyObject>;
type AnyFnArgs = FnArgs<any, AnyObject>;

function enhanceError(
	error: unknown,
	def: UnknownFnDef,
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

// #region --- Default Middleware ---

/**
 * Normalizes the args object to always have input and ctx.
 */
const withDefaults = createMiddleware(({ ctx, input, next }) => {
	// The next call receives the normalized context.
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
 * @returns A callable function with an attached .safeCall method.
 */
export function createFn<
	TInput = void,
	TOutput = void,
	TContext extends AnyObject = EmptyObject,
	THandler extends FnHandler<TInput, TOutput, TContext> = FnHandler<
		TInput,
		TOutput,
		TContext
	>,
>(
	def: FnDef<TInput, TOutput, TContext> & { handler: THandler }
): Fn<TInput, TOutput, TContext> {
	const getArgs = (args: any) => {
		const _args = args ?? {};
		const input = 'input' in _args ? _args.input : null;
		const ctx = 'ctx' in _args ? _args.ctx : {};
		return { input, ctx };
	};

	// The pipeline for the direct, throwing call.
	const directCall = async (args: any) => {
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

	// Define a type alias for the final output for cleaner casting
	type FinalOutput = TOutputSchema extends ZodTypeAny
		? zInfer<TOutputSchema>
		: Awaited<ReturnType<THandler>>;

	const result = Object.assign(directCall, defWithoutName, { safeCall });

	Object.defineProperty(result, 'name', {
		value: def.name,
		configurable: true,
	});

	return result;
}

// #endregion

// #region --- initCreateFn ---

// Primary initialization function - supports both array and builder patterns
export function initCreateFn<TContext extends AnyObject = EmptyObject>(
	middlewares?: Middleware<TContext>[]
): typeof createFn<TContext> {
	return (def: FnDef<TContext, any, any>) =>
		createFn<TContext>({
			...def,
			middleware: [...(middlewares || []), ...(def.middleware || [])] as any,
		});
}
