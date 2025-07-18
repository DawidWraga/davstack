/* eslint-disable no-unused-vars */
import { ZodTypeAny } from 'zod';
import { FnError } from './errors';
import { Simplify, zInfer, zInferInput } from './utils/type-utils';
import { redactSensitive } from './utils/zod-sensitive';

// Re-export FnError for convenience
export { FnError };

// #region --- Fn Types ---

type AnyObject = Record<string, any>;

/**
 * The core handler function's signature, generic over schema types (not inferred types).
 */
export type FnHandler<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject = AnyObject,
> = (args: {
	input: TInputSchema extends ZodTypeAny ? zInferInput<TInputSchema> : void;
	ctx: TContext;
}) => TOutputSchema extends ZodTypeAny
	? zInfer<TOutputSchema> | Promise<zInfer<TOutputSchema>>
	: any | Promise<any>;

/**
 * The definition object for creating a function. Uses schema types, not inferred types.
 */
export type FnDef<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject = AnyObject,
> = {
	name: string;
	description?: string;
	tags?: string[];
	inputSchema?: TInputSchema;
	outputSchema?: TOutputSchema;
	handler: FnHandler<TInputSchema, TOutputSchema, TContext>;
	middleware?: Middleware<any>[];
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
> = Condition extends void
	? Omit<T, K> & Partial<Pick<T, K>>
	: unknown extends Condition
		? Omit<T, K> & Partial<Pick<T, K>>
		: T;

/**
 * Helper type for function arguments with optional input and context.
 */
export type FnArgs<
	TInput = void,
	TContext extends AnyObject = AnyObject,
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
 * The main, user-facing Function type. Clean types only.
 */
export type Fn<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject = AnyObject,
	THandler extends FnHandler<TInputSchema, TOutputSchema, TContext> = FnHandler<
		TInputSchema,
		TOutputSchema,
		TContext
	>,
> = FnDef<TInputSchema, TOutputSchema, TContext> & {
	safeCall: (
		args: FnArgs<InferInput<TInputSchema>, TContext>
	) => Promise<Result<InferOutput<TOutputSchema, THandler>>>;
} & ((
		args: FnArgs<InferInput<TInputSchema>, TContext>
	) => Promise<InferOutput<TOutputSchema, THandler>>);

// #endregion

// #region --- Middleware  ---

// Internal type for middleware that needs to work with any function definition
type AnyFnDef = {
	name: string;
	description?: string;
	tags?: string[];
	inputSchema?: ZodTypeAny;
	outputSchema?: ZodTypeAny;
	handler: (...args: any[]) => any;
	middleware?: Middleware<any>[];
};

export type Middleware<
	TContext extends AnyObject = AnyObject,
	TNewContext extends AnyObject = TContext,
> = (opts: {
	ctx: TContext;
	input: unknown;
	def: AnyFnDef;
	next: (ctx?: TNewContext) => Promise<unknown> | unknown;
}) => Promise<unknown> | unknown;

/**
 * Helper to create properly typed middleware.
 */
export function createMiddleware<
	TContext extends AnyObject = AnyObject,
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
	def: AnyFnDef;
	args: { input: unknown; ctx: any };
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

function enhanceError(error: unknown, def: AnyFnDef, input: unknown): FnError {
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
 * Helper types for schema inference - only used inside createFn
 */
type InferInput<TInputSchema> = TInputSchema extends ZodTypeAny
	? zInferInput<TInputSchema>
	: void;

type InferOutput<TOutputSchema, THandler> = TOutputSchema extends ZodTypeAny
	? zInfer<TOutputSchema>
	: THandler extends (...args: any[]) => Promise<infer R>
		? R
		: THandler extends (...args: any[]) => infer R
			? R
			: any;

/**
 * Creates a new function with middleware and validation capabilities.
 * Schema generics are only here to do the inference, then we return clean types.
 */
export function createFn<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject = AnyObject,
	THandler extends FnHandler<TInputSchema, TOutputSchema, TContext> = FnHandler<
		TInputSchema,
		TOutputSchema,
		TContext
	>,
>(def: {
	name: string;
	description?: string;
	tags?: string[];
	inputSchema?: TInputSchema;
	outputSchema?: TOutputSchema;
	handler: THandler;
	middleware?: Middleware<any>[];
}): Fn<TInputSchema, TOutputSchema, TContext, THandler> {
	// Infer the clean types from schemas/handler
	type TInput = InferInput<TInputSchema>;
	type TOutput = InferOutput<TOutputSchema, THandler>;

	const getArgs = (args: any): { input: any; ctx: any } => {
		const _args = args ?? {};
		const input = 'input' in _args ? _args.input : undefined;
		const ctx = 'ctx' in _args ? _args.ctx : {};
		return { input, ctx };
	};

	// The pipeline for the direct, throwing call.
	const directCall = async (
		args: FnArgs<TInput, TContext>
	): Promise<TOutput> => {
		const callMiddleware: Middleware<any>[] = [
			withDefaults,
			withThrowingErrorHandler,
			...(def.middleware || []),
		];

		return executeMiddleware<TOutput>({
			def: { ...def, middleware: callMiddleware } as AnyFnDef,
			args: getArgs(args),
		});
	};

	// The pipeline for the non-throwing, safe call.
	const safeCall = async (
		args: FnArgs<TInput, TContext>
	): Promise<Result<TOutput>> => {
		const safeCallMiddleware: Middleware<any>[] = [
			withSafeResultFormatter, // 1. (Outer) Formats the final result.
			withThrowingErrorHandler, // 2. Catches and enhances any errors.
			withDefaults, // 3. Normalizes arguments.
			withInputValidation, // 4. Validates input schema.
			...(def.middleware || []), // 5. Executes user-defined middleware.
			withOutputValidation, // 6. (Inner) Validates output schema.
		];

		return executeMiddleware<Result<TOutput>>({
			def: { ...def, middleware: safeCallMiddleware } as AnyFnDef,
			args: getArgs(args),
		});
	};

	const { name, ...defWithoutName } = def;

	const result = Object.assign(directCall, defWithoutName, { safeCall });

	Object.defineProperty(result, 'name', {
		value: def.name,
		configurable: true,
	});

	return result as Fn<TInputSchema, TOutputSchema, TContext, THandler>;
}

// #endregion

// #region --- initCreateFn ---

/**
 * Primary initialization function - creates a function factory with pre-configured middleware.
 * Only stores the context type, schema inference happens in the returned createFn calls.
 */
export function initCreateFn<TContext extends AnyObject = AnyObject>(
	middlewares?: Middleware<any>[]
) {
	return <
		TInputSchema extends ZodTypeAny | undefined = undefined,
		TOutputSchema extends ZodTypeAny | undefined = undefined,
		THandler extends FnHandler<
			TInputSchema,
			TOutputSchema,
			TContext
		> = FnHandler<TInputSchema, TOutputSchema, TContext>,
	>(def: {
		name: string;
		description?: string;
		tags?: string[];
		inputSchema?: TInputSchema;
		outputSchema?: TOutputSchema;
		handler: THandler;
		middleware?: Middleware<any>[];
	}): Fn<TInputSchema, TOutputSchema, TContext, THandler> =>
		createFn<TInputSchema, TOutputSchema, TContext, THandler>({
			...def,
			middleware: [
				...(middlewares || []),
				...(def.middleware || []),
			] as Middleware<any>[],
		});
}

// #endregion
