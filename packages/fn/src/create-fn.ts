/* eslint-disable no-unused-vars */

import { FnError, isFnError } from './errors';
import { isFormData, formDataToObject } from './utils/form-data';
import { Simplify, zInfer, zInferInput, ZodTypeAny } from './utils/type-utils';

// Re-export FnError for convenience
export { FnError };

// #region --- Fn Types ---

type InferInput<TInputSchema> = TInputSchema extends ZodTypeAny
	? zInferInput<TInputSchema>
	: void;

type MaybeZInfer<T> = T extends ZodTypeAny ? zInfer<T> : void;

type InferOutput<TOutputSchema, THandler> = TOutputSchema extends ZodTypeAny
	? zInfer<TOutputSchema>
	: THandler extends (...args: any[]) => Promise<infer R>
		? R
		: THandler extends (...args: any[]) => infer R
			? R
			: any;

type AnyObject = Record<string, any>;

/**
 * The core handler function's signature, generic over schema types (not inferred types).
 */
export type FnHandler<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject | undefined = undefined,
> = (
	args: {
		// we use infer input on the caller (eg safeCall, or directDirect call with Fn(), but this handler type is used for the DEFINITION so internally we can trust we'll have the defaults so can use infer output instead (will be parsed)
		input: MaybeZInfer<TInputSchema>;
	} & (TContext extends undefined ? { ctx?: any } : { ctx: TContext })
) => TOutputSchema extends ZodTypeAny
	? zInfer<TOutputSchema> | Promise<zInfer<TOutputSchema>>
	: any | Promise<any>;

/**
 * The definition object for creating a function. Uses schema types, not inferred types.
 */
export type FnDef<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject | undefined = undefined,
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
> = Condition extends void | undefined
	? Omit<T, K> & Partial<Pick<T, K>>
	: unknown extends Condition
		? Omit<T, K> & Partial<Pick<T, K>>
		: T;

/**
 * Helper type for function arguments with optional input and context.
 */
// export type FnArgs<TInput = void, TContext extends AnyObject | undefined = undefined> = {
// 	input: TInput;
// 	ctx: TContext;
// };

// export type FnArgs<
// 	TInput = void,
// 	TContext extends AnyObject | undefined = undefined,
// > = Simplify<
// 	OptionallyRequiredField<
// 		'input',
// 		TInput,
// 		OptionallyRequiredField<
// 			'ctx',
// 			TContext,
// 			{
// 				input: TInput;
// 				ctx: TContext;
// 			}
// 		>
// 	>
// >;

// /**
export type FnArgs<
	TInput = void,
	TContext extends AnyObject | undefined = undefined,
> = Simplify<
	// Maybe input
	(TInput extends undefined | void ? { input?: void } : { input: TInput }) &
		// Maybe context
		(TContext extends undefined ? { ctx?: undefined } : { ctx: TContext })
>;

/**
 * The main, user-facing Function type. Clean types only.
 */
export type Fn<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject | undefined = undefined,
	THandler extends FnHandler<TInputSchema, TOutputSchema, TContext> = FnHandler<
		TInputSchema,
		TOutputSchema,
		TContext
	>,
> = FnDef<TInputSchema, TOutputSchema, TContext> &
	// Maybe inputSchema
	(TInputSchema extends undefined
		? { inputSchema?: undefined }
		: { inputSchema: TInputSchema }) &
	// Maybe outputSchema
	(TOutputSchema extends undefined
		? { outputSchema?: undefined }
		: { outputSchema: TOutputSchema }) & {
		safeCall: (
			args: FnArgs<InferInput<TInputSchema>, TContext>
		) => Promise<Result<InferOutput<TOutputSchema, THandler>>>;
	} & ((
		args: FnArgs<InferInput<TInputSchema>, TContext>
	) => Promise<InferOutput<TOutputSchema, THandler>>);

// #endregion

// #region --- Middleware  ---

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
	TContext extends AnyObject | undefined = undefined,
	TNewContext extends AnyObject | undefined = TContext,
> = (opts: {
	ctx: TContext;
	input: unknown;
	def: AnyFnDef;
	next: (ctx?: TNewContext, input?: unknown) => Promise<unknown> | unknown;
}) => Promise<unknown> | unknown;

/**
 * Helper to create properly typed middleware.
 */
export function createMiddleware<
	TContext extends AnyObject | undefined = undefined,
	TNewContext extends AnyObject | undefined = TContext,
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

	const run = async (
		index: number,
		currentCtx: any,
		currentInput: any
	): Promise<T> => {
		if (index >= (def.middleware?.length ?? 0)) {
			// Pass the potentially modified context and the final input to the handler
			return def.handler({ input: currentInput, ctx: currentCtx }) as T;
		}

		const middleware = def.middleware?.[index]!;

		// The `next` function for this specific middleware.
		// It will call `run` for the *next* middleware.
		// If the current middleware provides a new context or input, we use it.
		// Otherwise, we pass along the ones we received.
		const next = (newCtx: any = currentCtx, newInput: any = currentInput) => {
			return run(index + 1, newCtx, newInput);
		};

		return middleware({
			ctx: currentCtx,
			input: currentInput,
			def,
			next,
		}) as T;
	};

	return run(0, args.ctx, args.input);
}

/**
 * Enhances an error by wrapping it in an FnError (if it isn't one already),
 * and adds a trace of function calls to the metadata.
 * This ensures the original error `cause` and stack trace are preserved.
 */
function enhanceError(error: unknown, def: AnyFnDef, input: unknown): FnError {
	const isOriginalFnError = error instanceof FnError;
	// FnError.from will return the same instance if it's already an FnError
	const fnError = FnError.from(error);

	// If this is the first time we're wrapping the error, initialize the trace and add input
	if (!isOriginalFnError) {
		fnError.meta.functionTrace = [];
		fnError.meta.input = input;
	}

	// Add the current function to the start of the trace to build a call stack
	// e.g., [outerFn, middleFn, innerFn]
	const trace = (fnError.meta.functionTrace || []) as string[];
	trace.unshift(def.name);
	fnError.meta.functionTrace = trace;

	// The `functionName` should reflect the function that most recently handled the error
	fnError.meta.functionName = def.name;

	return fnError;
}

// #endregion

// #region --- Default Middleware ---

/**
 * Input validation middleware.
 */
const withInputValidation = createMiddleware(({ ctx, input, def, next }) => {
	const schema = def.inputSchema;
	if (!schema) {
		// If no schema, pass input through unchanged.
		return next(ctx, input);
	}

	const dataToValidate = isFormData(input) ? formDataToObject(input) : input;

	const result = (schema as any).safeParse(dataToValidate);
	if (!result.success) {
		throw new FnError({
			code: 'INVALID_INPUT',
			cause: result.error,
			meta: { zodErrors: result.error.flatten() },
		});
	}
	// Pass the PARSED data to the next middleware/handler.
	return next(ctx, result.data);
});

/**
 * Output validation middleware.
 */
const withOutputValidation = createMiddleware(
	async ({ ctx, input, def, next }) => {
		const schema = def.outputSchema;
		// The call to next() needs to pass the input along
		if (!schema) return next(ctx, input);

		const result = await next(ctx, input); // pass input through
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
			return await next(ctx, input); // pass input through
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
			const data = await next(ctx, input); // pass input through
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
 * Schema generics are only here to do the inference, then we return clean types.
 */
export function createFn<
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined = undefined,
	TContext extends AnyObject | undefined = undefined,
	// need it for inferring the return type of the handler
	THandler extends FnHandler<TInputSchema, TOutputSchema, TContext> = FnHandler<
		TInputSchema,
		TOutputSchema,
		TContext
	>,
>(
	def: FnDef<TInputSchema, TOutputSchema, TContext> & {
		handler: THandler;
	}
): Fn<TInputSchema, TOutputSchema, TContext, THandler> {
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
	const directCall = async (args: any) => {
		const callMiddleware: Middleware<any>[] = [
			withThrowingErrorHandler,
			// need to validate input so that we get eg defaults/transforms.
			// for fully raw call can use .handler() directly
			withInputValidation,
			...(def.middleware || []),
			withOutputValidation,
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
			withInputValidation, // 3. Validates input schema.
			...(def.middleware || []), // 4. Executes user-defined middleware.
			withOutputValidation, // 5. (Inner) Validates output schema.
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

	return result as unknown as Fn<
		TInputSchema,
		TOutputSchema,
		TContext,
		THandler
	>;
}

// #endregion

// #region --- initCreateFn ---

/**
 * Primary initialization function - creates a function factory with pre-configured middleware.
 * Only stores the context type, schema inference happens in the returned createFn calls.
 */
export function initCreateFn<
	TContext extends AnyObject | undefined = undefined,
>(middlewares?: Middleware<any>[]) {
	return <
		TInputSchema extends ZodTypeAny | undefined = undefined,
		TOutputSchema extends ZodTypeAny | undefined = undefined,
		THandler extends FnHandler<
			TInputSchema,
			TOutputSchema,
			TContext
		> = FnHandler<TInputSchema, TOutputSchema, TContext>,
	>(
		def: FnDef<TInputSchema, TOutputSchema, TContext> & {
			handler: THandler;
		}
	): Fn<TInputSchema, TOutputSchema, TContext, THandler> =>
		createFn<TInputSchema, TOutputSchema, TContext, THandler>({
			...def,
			middleware: [
				...(middlewares || []),
				...(def.middleware || []),
			] as Middleware<any>[],
		});
}

// #endregion
