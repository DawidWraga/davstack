/* eslint-disable no-unused-vars */
import { z, ZodObject, ZodRawShape, ZodSchema, ZodTypeAny } from 'zod';
import { FnError, isFnError } from './errors';
import { Simplify, zInfer, zInferInput } from './utils/type-utils';
import { redactSensitive } from './utils/zod-sensitive';

// Generic type for handler functions
export type FnHandler<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	TContext extends Record<string, any> | unknown = unknown,
> = (opts: {
	input: TInputSchema extends ZodTypeAny ? zInferInput<TInputSchema> : null;
	ctx: Simplify<TContext>;
}) => Promise<TOutputSchema extends ZodTypeAny ? zInfer<TOutputSchema> : void>;

export type ZodSchemaOrRawShape = ZodSchema<any> | ZodRawShape;
export type InferZodSchemaOrRawShape<T extends ZodSchemaOrRawShape> =
	T extends ZodRawShape ? ZodObject<T> : T;

export type Middleware<
	TContext extends Record<string, any> | unknown,
	TNewContext extends unknown = unknown,
> = (opts: {
	ctx: TContext;
	next: (ctx?: TNewContext) => Promise<TNewContext>;
}) => Promise<TNewContext>;

export type FnResolverOptions = {
	input: unknown;
	ctx: Record<string, any>;
	meta: Record<string, any>;
	inputSchema: ZodSchema<any> | undefined;
	outputSchema: ZodSchema<any> | undefined;
};

export type FnBuilderOptions = {
	onError?: (opts: FnResolverOptions & { error: Error }) => void;
	wrapper?: (
		innerFn: (opts: FnResolverOptions) => Promise<any>
	) => (opts: FnResolverOptions & { preventLogging?: boolean }) => Promise<any>;
	forceSchemaValidation?: boolean;
	preventLogging?: boolean;
};

export type FnMeta = {
	key?: string;
	invalidates?: string[];
	[key: string]: any;
};

export type FnDef<
	THandler extends FnHandler<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> = {
	inputSchema: TInputSchema;
	outputSchema: TOutputSchema;
	handler: THandler;
	type: TType;
	middleware: Middleware<TContext, TContext>[];
	options?: FnBuilderOptions;
	meta?: FnMeta;
};

const initialDef = {
	inputSchema: undefined,
	outputSchema: undefined,
	handler: undefined,
	type: undefined,
	middleware: [] as Middleware<any, any>[],
	options: undefined as FnBuilderOptions | undefined,
	meta: undefined as FnMeta | undefined,
};

export function baseFn<
	TContext extends Record<string, any> | unknown = undefined,
>() {
	function createBuilder<
		TInputSchema extends ZodTypeAny | undefined,
		TOutputSchema extends ZodTypeAny | undefined,
		TType extends 'mutation' | 'query' | undefined,
		TContextOverride extends Record<string, any> | unknown = unknown,
	>(
		def: FnDef<any, TInputSchema, TOutputSchema, TType, TContextOverride>
	): FnBuilder<TInputSchema, TOutputSchema, TType, TContextOverride> {
		return {
			input<TNewInputSchema extends ZodSchemaOrRawShape>(
				schema: TNewInputSchema
			) {
				const inputSchema =
					schema instanceof ZodSchema ? schema : z.object(schema);
				return createBuilder({
					...def,
					inputSchema: inputSchema as InferZodSchemaOrRawShape<TNewInputSchema>, // handle zod object or raw shape
				});
			},
			output<TNewOutputSchema extends ZodSchemaOrRawShape>(
				schema: TNewOutputSchema
			) {
				const outputSchema =
					schema instanceof ZodSchema ? schema : z.object(schema);
				return createBuilder({
					...def,
					outputSchema:
						outputSchema as InferZodSchemaOrRawShape<TNewOutputSchema>,
				});
			},

			use<TNewContext extends TContextOverride>(
				middleware: Middleware<TContextOverride, TNewContext>
			) {
				return createBuilder({
					...def,
					// @ts-expect-error
					middleware: [...def.middleware, middleware],
				}) as unknown as FnBuilder<
					TInputSchema,
					TOutputSchema,
					TType,
					TNewContext
				>;
			},
			options(newOptions: FnBuilderOptions) {
				return createBuilder({
					...def,
					options: {
						...def.options,
						...newOptions,
					},
				});
			},

			meta(newMeta: FnMeta) {
				return createBuilder({
					...def,
					meta: {
						...def.meta,
						...newMeta,
					},
				});
			},
			mutation<
				THandler extends FnHandler<
					TInputSchema,
					TOutputSchema,
					TContextOverride
				>,
			>(handler: THandler) {
				const newDef: FnDef<
					THandler,
					TInputSchema,
					TOutputSchema,
					'mutation',
					TContextOverride
				> = {
					...def,
					handler,
					type: 'mutation',
				};
				return createFn(newDef) as unknown as Fn<
					THandler,
					TInputSchema,
					TOutputSchema,
					'mutation',
					TContextOverride
				>;
			},
			query<
				THandler extends FnHandler<
					TInputSchema,
					TOutputSchema,
					TContextOverride
				>,
			>(handler: THandler) {
				const newDef: FnDef<
					THandler,
					TInputSchema,
					TOutputSchema,
					'query',
					TContextOverride
				> = {
					...def,
					handler,
					type: 'query',
				};
				return createFn(newDef) as unknown as Fn<
					THandler,
					TInputSchema,
					TOutputSchema,
					'query',
					TContextOverride
				>;
			},
		};
	}

	const builder = createBuilder<undefined, any, any, TContext>({
		...initialDef,
	});

	return builder;
}

export interface FnBuilder<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> {
	input: <TNewInputSchema extends ZodSchemaOrRawShape>(
		schema: TNewInputSchema
	) => FnBuilder<
		InferZodSchemaOrRawShape<TNewInputSchema>,
		TOutputSchema,
		TType,
		TContext
	>;
	output: <TNewOutputSchema extends ZodSchemaOrRawShape>(
		schema: TNewOutputSchema
	) => FnBuilder<
		TInputSchema,
		InferZodSchemaOrRawShape<TNewOutputSchema>,
		TType,
		TContext
	>;
	use: <TNewContext extends TContext>(
		middleware: Middleware<TContext, TNewContext>
	) => FnBuilder<TInputSchema, TOutputSchema, TType, TNewContext>;
	options: (
		options: FnBuilderOptions
	) => FnBuilder<TInputSchema, TOutputSchema, TType, TContext>;

	meta: (
		meta: FnMeta
	) => FnBuilder<TInputSchema, TOutputSchema, TType, TContext>;

	mutation: <THandler extends FnHandler<TInputSchema, TOutputSchema, TContext>>(
		handler: THandler
	) => Fn<THandler, TInputSchema, TOutputSchema, 'mutation', TContext>;
	query: <THandler extends FnHandler<TInputSchema, TOutputSchema, TContext>>(
		handler: THandler
	) => Fn<THandler, TInputSchema, TOutputSchema, 'query', TContext>;
}

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
				preventLogging?: boolean;
			}
		>
	>
>;

export type Fn<
	THandler extends FnHandler<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> = FnDef<THandler, TInputSchema, TOutputSchema, TType, TContext> & {
	safeCall: (
		opts: FnArgs<TInputSchema, TContext>
	) => Promise<Result<Simplify<Awaited<ReturnType<THandler>>>>>;
} & ((
		opts: FnArgs<TInputSchema, TContext>
	) => Promise<Awaited<ReturnType<THandler>>>);

// Helper function to enhance errors with metadata and report them
function enhanceAndReportError(
	error: unknown,
	{
		def,
		input,
		ctx,
	}: {
		def: FnDef<any, any, any, any, any>;
		input: any;
		ctx: any;
	}
): Error {
	// Skip if already reported to prevent duplicate handling
	if ((error as any)._reported) {
		return error as Error;
	}

	// Create a minimal, focused metadata object
	const errorMeta: {
		functionKey?: string;
		functionType?: any;
		input?: any;
	} = {
		functionKey: def.meta?.key,
		functionType: def.type,
	};

	// If input validation is important, include sanitized input
	if (def.inputSchema) {
		errorMeta.input = redactSensitive(input, def.inputSchema);
	}

	// Handle FnErrors - preserve their structure and just update metadata
	if (isFnError(error)) {
		// Add metadata without recreating the error
		Object.assign(error.meta, errorMeta);

		// Report error if handler is configured
		if (def.options?.onError) {
			def.options.onError({
				error,
				ctx,
				meta: def.meta || {},
				input: redactSensitive(input, def.inputSchema),
				inputSchema: def.inputSchema,
				outputSchema: def.outputSchema,
			});
		}

		// Mark as reported
		Object.defineProperty(error, '_reported', { value: true });

		return error;
	}

	// For other errors, convert while keeping original stack trace
	const enhancedError = FnError.from(error, { meta: errorMeta });

	// Report error if handler is configured
	if (def.options?.onError) {
		def.options.onError({
			error: enhancedError,
			ctx,
			meta: def.meta || {},
			input: redactSensitive(input, def.inputSchema),
			inputSchema: def.inputSchema,
			outputSchema: def.outputSchema,
		});
	}

	// Mark as reported
	Object.defineProperty(enhancedError, '_reported', { value: true });

	return enhancedError;
}

/**
 * Validates input and output against schemas if available
 * Added special handling for functions to avoid serialization issues
 */
async function validateWithSchema<TInput, TOutput>({
	input,
	execute,
	inputSchema,
	outputSchema,
}: {
	input: TInput;
	execute: (parsedInput: any) => Promise<TOutput>;
	inputSchema?: ZodTypeAny;
	outputSchema?: ZodTypeAny;
}): Promise<TOutput> {
	// Parse and validate input if schema exists
	const parsedInput = inputSchema
		? (() => {
				const result = inputSchema.safeParse(input);
				if (!result.success) {
					throw new FnError({
						code: 'INVALID_INPUT',
						message: `Invalid input: ${JSON.stringify(result.error.flatten())}`,
						cause: result.error,
						meta: {
							// Avoid including function values directly in error meta
							input: redactSensitive(input, inputSchema),
							zodErrors: result.error.flatten(),
						},
					});
				}
				return result.data;
			})()
		: input;

	// Execute with validated input
	const result = await execute(parsedInput);

	// Parse and validate output if schema exists
	if (outputSchema) {
		const outputResult = outputSchema.safeParse(result);
		if (!outputResult.success) {
			throw new FnError({
				code: 'INVALID_OUTPUT',
				message: `Invalid output: ${JSON.stringify(
					outputResult.error.flatten()
				)}`,
				cause: outputResult.error,
				meta: {
					// Avoid including function values directly in error meta
					result: redactSensitive(result, outputSchema),
					zodErrors: outputResult.error.flatten(),
				},
			});
		}
		return outputResult.data;
	}

	return result;
}

export function createFn<
	THandler extends FnHandler<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined,
	TType extends 'mutation' | 'query',
	TContext extends Record<string, any> | unknown,
>(def: FnDef<THandler, TInputSchema, TOutputSchema, TType, TContext>) {
	/**
	 * Invokes the handler with middleware logic and applies wrapper if configured
	 */
	const invokeWithMiddleware = async (
		ctx: TContext,
		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : void,
		middlewares: Middleware<TContext, TContext>[] = def.middleware,
		preventLogging?: boolean
	) => {
		let currentCtx = ctx;

		const executeMiddleware = async (index: number): Promise<any> => {
			if (index >= middlewares.length) {
				return def.handler({ input, ctx: currentCtx });
			} else {
				const currentMiddleware = middlewares[index]!;
				return await currentMiddleware({
					ctx: currentCtx,
					next: async (newCtx?: TContext) => {
						currentCtx = newCtx || currentCtx;
						return executeMiddleware(index + 1);
					},
				});
			}
		};

		// This is the core handler invocation
		const executeResolverWithMiddleware = async () => {
			return executeMiddleware(0);
		};

		// Apply wrapper if configured
		if (def.options?.wrapper) {
			return def.options.wrapper((opts) => executeResolverWithMiddleware())({
				input: redactSensitive(input, def.inputSchema),
				ctx: ctx as any,
				meta: def.meta || {},
				inputSchema: def.inputSchema,
				outputSchema: def.outputSchema,
				preventLogging: preventLogging || def.options.preventLogging,
			});
		}

		return executeResolverWithMiddleware();
	};

	/**
	 * Invokes the handler without parsing input/output, but with middleware logic.
	 * Validates schemas if forceSchemaValidation option is enabled.
	 */
	const defaultCall = async (opts: FnArgs<TInputSchema, TContext>) => {
		try {
			// Extract input and context from object parameter, with fallbacks for when they're optional
			const _opts = opts ?? ({} as any);
			const input = 'input' in _opts ? _opts.input : undefined;
			const ctx = 'ctx' in _opts ? _opts.ctx : ({} as TContext);
			const preventLogging = _opts.preventLogging;

			// Check if we should force schema validation
			if (def.options?.forceSchemaValidation === true) {
				return await validateWithSchema({
					input,
					execute: (parsedInput) =>
						invokeWithMiddleware(
							ctx ?? ({} as TContext),
							parsedInput,
							def.middleware,
							preventLogging
						),
					inputSchema: def.inputSchema,
					outputSchema: def.outputSchema,
				});
			}

			// Standard execution without validation
			const result = await invokeWithMiddleware(
				ctx ?? ({} as TContext),
				input ??
					({} as TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : void),
				def.middleware,
				preventLogging
			);
			return result;
		} catch (error) {
			// Enhance and report the error
			const enhancedError = enhanceAndReportError(error, {
				def,
				input: opts.input,
				ctx: opts.ctx,
			});

			// Throw the enhanced error
			throw enhancedError;
		}
	};

	/**
	 * Invokes the handler with parsing input/output and middleware logic
	 * Called via .safeCall() for schema validation
	 */
	const safeCall = async (
		opts: FnArgs<TInputSchema, TContext>
	): Promise<Result<any>> => {
		// Extract input and context with fallbacks
		const _opts = opts ?? ({} as any);
		try {
			const input = 'input' in _opts ? _opts.input : undefined;
			const ctx = ('ctx' in _opts ? _opts.ctx : {}) as TContext;
			const preventLogging = _opts.preventLogging;

			const execute = async (parsedInput: any) => {
				return await invokeWithMiddleware(
					ctx,
					parsedInput,
					def.middleware,
					preventLogging
				);
			};

			// Use the shared validation function
			const result = await validateWithSchema({
				input,
				execute,
				inputSchema: def.inputSchema,
				outputSchema: def.outputSchema,
			});

			return { data: result, error: null };
		} catch (error) {
			// Enhance and report the error
			const enhancedError = enhanceAndReportError(error, {
				def,
				input: 'input' in _opts ? _opts.input : null,
				ctx: _opts.ctx,
			});

			return { data: null, error: enhancedError };
		}
	};

	return Object.assign(defaultCall, def, { safeCall });
}

import { getMaybeFormDataValue } from './utils/form-data';
