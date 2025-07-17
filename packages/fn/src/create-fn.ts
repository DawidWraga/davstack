/* eslint-disable no-unused-vars */
import { ZodTypeAny } from 'zod';
import { FnError } from './errors';
import { pipe } from './pipe';
import { Simplify, zInfer, zInferInput } from './utils/type-utils';
import { redactSensitive } from './utils/zod-sensitive';

// --- Type Definitions ---

export type FnHandler<
	TContext extends Record<string, any> | unknown = unknown,
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutput = any,
> = (opts: {
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
		opts: FnArgs<TInputSchema, TContext>
	) => Promise<Result<Awaited<ReturnType<THandler>>>>;
} & ((
		opts: FnArgs<TInputSchema, TContext>
	) => Promise<Awaited<ReturnType<THandler>>>);

// --- Helper Functions ---
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

// --- Composable Wrappers ---

/**
 * Normalizes the opts object to always have `input` and `ctx`.
 * This simplifies the signatures of all subsequent wrappers.
 */
function withDefaults<THandler extends FnHandler<any, any, any>>(
	handler: THandler
): THandler {
	const wrappedHandler = (opts: any) => {
		const _opts = opts ?? {};
		const input = 'input' in _opts ? _opts.input : undefined;
		const ctx = 'ctx' in _opts ? _opts.ctx : {};
		return handler({ input, ctx });
	};
	return wrappedHandler as THandler;
}

function withInputValidation<THandler extends FnHandler<any, any, any>>(
	def: FnDef<any, any, any, any>,
	handler: THandler
): THandler {
	const schema = def.inputSchema;
	if (!schema) return handler;

	const wrappedHandler = async (opts: any) => {
		const result = schema.safeParse(opts.input);
		if (!result.success) {
			throw new FnError({
				code: 'INVALID_INPUT',
				cause: result.error,
				meta: { zodErrors: result.error.flatten() },
			});
		}
		return handler({ ...opts, input: result.data });
	};
	return wrappedHandler as THandler;
}

function withOutputValidation<THandler extends FnHandler<any, any, any>>(
	def: FnDef<any, any, any, any>,
	handler: THandler
): THandler {
	const schema = def.outputSchema;
	if (!schema) return handler;

	const wrappedHandler = async (opts: any) => {
		const result = await handler(opts);
		const validationResult = (schema as any).safeParse(result);
		if (!validationResult.success) {
			throw new FnError({
				code: 'INVALID_OUTPUT',
				cause: validationResult.error,
				meta: { zodErrors: validationResult.error.flatten() },
			});
		}
		return validationResult.data;
	};
	return wrappedHandler as THandler;
}

function withThrowingErrorHandler<THandler extends FnHandler<any, any, any>>(
	def: FnDef<any, any, any, any>,
	handler: THandler
): THandler {
	const wrappedHandler = async (opts: any) => {
		try {
			return await handler(opts);
		} catch (error) {
			throw enhanceError(error, def, opts?.input);
		}
	};
	return wrappedHandler as THandler;
}

function withSafeResultFormatter<THandler extends FnHandler<any, any, any>>(
	_def: FnDef<any, any, any, any>,
	handler: THandler
): (opts: any) => Promise<Result<Awaited<ReturnType<THandler>>>> {
	return async (opts) => {
		try {
			const data = await handler(opts);
			return { data, error: null };
		} catch (error) {
			return { data: null, error: error as FnError };
		}
	};
}

// --- The `createFn` Implementation ---

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
	// The default call pipeline
	const callFn = pipe(
		def.handler,
		(h) => withThrowingErrorHandler(def, h),
		(h) => withDefaults(h)
	);

	// The safe call pipeline
	const safeCall = pipe(
		def.handler,
		(h) => withOutputValidation(def, h),
		(h) => withInputValidation(def, h),
		(h) => withThrowingErrorHandler(def, h),
		(h) => withSafeResultFormatter(def, h),
		(h) => withDefaults(h)
	);

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
