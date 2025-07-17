/* eslint-disable no-unused-vars */
import { ZodTypeAny } from 'zod';
import { FnError } from './errors';
import { pipe } from './pipe';
import { Simplify, zInfer, zInferInput } from './utils/type-utils';
import { redactSensitive } from './utils/zod-sensitive';

// #region --- Type Definitions ---

export type FnHandler<
	TContext extends Record<string, any> | unknown = unknown,
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutput = any,
> = (args: {
	input: TInputSchema extends ZodTypeAny ? zInferInput<TInputSchema> : null;
	ctx: Simplify<TContext>;
}) => Promise<TOutput>;

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

export type Result<T> =
	| { data: T; error: null }
	| { data: null; error: FnError | Error };

export type OptionallyRequiredField<
	K extends string,
	Condition,
	T extends Record<string, any>,
> = Condition extends undefined ? Omit<T, K> & Partial<Pick<T, K>> : T;

/**
 * Helper type for function arguments with optional input and context
 *
 * If there is no input, then the input field is optional (instead of just void)
 * If there is no ctx, then the ctx field is optional (instead of just void)
 *
 * this allows us to not have to call
 * myFn({ input: undefined, ctx }) or
 * myFn({ input: undefined, ctx: undefined })
 *
 * We can simply use myFn({ctx}) or myFn()
 */
export type FnArgs<
	TInputSchema extends ZodTypeAny | undefined,
	TContext extends Record<string, any> | unknown,
> = Simplify<
	OptionallyRequiredField<
		'input',
		TInputSchema,
		OptionallyRequiredField<
			'ctx',
			TContext,
			{
				input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : void;
				ctx: TContext;
				def?: Omit<FnDef<TContext, TInputSchema, any, any>, 'handler'>;
			}
		>
	>
>;

export type Fn<
	TContext extends Record<string, any> | unknown = unknown,
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown = undefined,
	THandler extends FnHandler<TContext, TInputSchema, any> = FnHandler<
		TContext,
		TInputSchema,
		any
	>,
> = FnDef<TContext, TInputSchema, TOutputSchema, THandler> & {
	safeCall: (
		args: FnArgs<TInputSchema, TContext>
	) => Promise<Result<Awaited<ReturnType<THandler>>>>;
} & ((
		args: FnArgs<TInputSchema, TContext>
	) => Promise<Awaited<ReturnType<THandler>>>);

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
 * Helper to create properly typed middleware
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
 * Execute middleware chain
 */
async function executeMiddleware<T>(opts: {
	def: FnDef<any, any, any, any>;
	args: FnArgs<any, any>;
}): Promise<T> {
	const { def, args } = opts;
	let index = 0;

	async function next(newCtx = args.ctx): Promise<T> {
		if (index >= (def.middleware?.length ?? 0)) {
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

// #region --- Built-in Middleware ---

/**
 * Normalizes the args object to always have `input` and `ctx`.
 */
const withDefaults = createMiddleware(({ ctx, input, next }) => {
	const normalizedCtx = ctx ?? {};
	const normalizedInput = input ?? undefined;
	return next(normalizedCtx);
});

/**
 * Input validation middleware
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

	// Pass validated input to the next middleware/handler
	return next(ctx);
});

/**
 * Output validation middleware
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
 * Error handling middleware
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
 * Safe result formatting middleware
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

// #region ---  `createFn`

export function createFn<
	TContext extends Record<string, any> | unknown = unknown,
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown = undefined,
	THandler extends FnHandler<TContext, TInputSchema, any> = FnHandler<
		TContext,
		TInputSchema,
		any
	>,
>(
	def: FnDef<TContext, TInputSchema, TOutputSchema, THandler>
): Fn<TContext, TInputSchema, TOutputSchema, THandler> {
	// The default call pipeline middleware

	const callMiddleware = [
		withDefaults,
		withInputValidation,
		withThrowingErrorHandler,
		...(def.middleware || []),
	];

	// The safe call pipeline middleware
	const safeCallMiddleware = [
		withDefaults,
		withInputValidation,
		withOutputValidation,
		withThrowingErrorHandler,
		withSafeResultFormatter,
		...(def.middleware || []),
	];

	const getArgs = (args: any) => {
		const _args = args ?? {};
		const input = 'input' in _args ? _args.input : null;
		const ctx = 'ctx' in _args ? _args.ctx : {};
		return { input, ctx };
	};

	// Create the main function
	const callFn = async (args: any) => {
		return executeMiddleware({
			def: {
				...def,
				middleware: [...callMiddleware, ...(def.middleware || [])],
			},
			args: getArgs(args),
		});
	};

	// Create the safe call function
	const safeCall = async (args: any) => {
		return executeMiddleware({
			def: {
				...def,
				middleware: [...safeCallMiddleware, ...(def.middleware || [])],
			},
			args: getArgs(args),
		});
	};

	// cannot assign the name property as it's readonly reserved word
	const { name, ...defWithoutName } = def;
	// Create the function first
	const result = Object.assign(callFn, defWithoutName, { safeCall }) as Fn<
		TContext,
		TInputSchema,
		TOutputSchema,
		THandler
	>;

	// Set the actual function name
	Object.defineProperty(result, 'name', {
		value: def.name,
		configurable: true,
	});

	return result;
}
