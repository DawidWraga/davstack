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
	TOutputSchema extends ZodTypeAny | undefined | unknown = undefined,
> = (opts: {
	input: TInputSchema extends ZodTypeAny ? zInferInput<TInputSchema> : null;
	ctx: Simplify<TContext>;
}) => Promise<TOutputSchema extends ZodTypeAny ? zInfer<TOutputSchema> : void>;

export type FnDef<
	TContext extends Record<string, any> | unknown = unknown,
	TInputSchema extends ZodTypeAny | undefined = undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown = undefined,
> = {
	name: string;
	description?: string;
	tags?: string[];
	inputSchema: TInputSchema;
	outputSchema?: TOutputSchema;
	handler: FnHandler<TContext, TInputSchema, TOutputSchema>;
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
> = FnDef<TContext, TInputSchema, TOutputSchema> & {
	safeCall: (
		opts: FnArgs<TInputSchema, TContext>
	) => Promise<
		Result<
			Awaited<ReturnType<FnHandler<TContext, TInputSchema, TOutputSchema>>>
		>
	>;
} & ((
		opts: FnArgs<TInputSchema, TContext>
	) => Promise<
		Awaited<ReturnType<FnHandler<TContext, TInputSchema, TOutputSchema>>>
	>);

// --- Helper Functions ---
function enhanceError(
	error: unknown,
	def: FnDef<any, any, any>,
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
function withDefaults<TFnHandler extends FnHandler<any, any, any>>(
	handler: TFnHandler
): TFnHandler {
	const wrappedHandler = (opts: any) => {
		const _opts = opts ?? {};
		const input = 'input' in _opts ? _opts.input : undefined;
		const ctx = 'ctx' in _opts ? _opts.ctx : {};
		return handler({ input, ctx });
	};
	return wrappedHandler as TFnHandler;
}

function withInputValidation<TFnHandler extends FnHandler<any, any, any>>(
	def: FnDef<any, any, any>,
	handler: TFnHandler
): TFnHandler {
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
	return wrappedHandler as TFnHandler;
}

function withOutputValidation<TFnHandler extends FnHandler<any, any, any>>(
	def: FnDef<any, any, any>,
	handler: TFnHandler
): TFnHandler {
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
	return wrappedHandler as TFnHandler;
}

function withThrowingErrorHandler<TFnHandler extends FnHandler<any, any, any>>(
	def: FnDef<any, any, any>,
	handler: TFnHandler
): TFnHandler {
	const wrappedHandler = async (opts: any) => {
		try {
			return await handler(opts);
		} catch (error) {
			throw enhanceError(error, def, opts?.input);
		}
	};
	return wrappedHandler as TFnHandler;
}

function withSafeResultFormatter<TFnHandler extends FnHandler<any, any, any>>(
	_def: FnDef<any, any, any>,
	handler: TFnHandler
): (opts: any) => Promise<Result<Awaited<ReturnType<TFnHandler>>>> {
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
>(
	def: FnDef<TContext, TInputSchema, TOutputSchema>
): Fn<TContext, TInputSchema, TOutputSchema> {
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

	// We cast the final result. This is a safe assertion because we've
	// constructed the object to match the `Fn` interface.
	return Object.assign(callFn, def, { safeCall }) as Fn<
		TContext,
		TInputSchema,
		TOutputSchema
	>;
}
