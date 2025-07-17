/* eslint-disable no-unused-vars */
import { ZodTypeAny } from 'zod';
import { FnError } from './errors';
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
	middleware?: Middleware<any>[];
};

// --- Middleware System ---

export type Middleware<
	TContext extends Record<string, any> | unknown = unknown,
	TNewContext extends Record<string, any> | unknown = TContext
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
	TNewContext extends Record<string, any> | unknown = TContext
>(
	middlewareFn: Middleware<TContext, TNewContext>
): Middleware<TContext, TNewContext> {
	return middlewareFn;
}

/**
 * Execute middleware chain
 */
async function executeMiddleware<T>(
	middlewares: Middleware<any>[],
	ctx: any,
	input: any,
	def: FnDef<any, any, any, any>,
	finalHandler: () => Promise<T>
): Promise<T> {
	let index = 0;

	async function next(newCtx = ctx): Promise<T> {
		if (index >= middlewares.length) {
			return finalHandler();
		}

		const middleware = middlewares[index++];
		return middleware({
			ctx: newCtx,
			input,
			def,
			next,
		});
	}

	return next(ctx);
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