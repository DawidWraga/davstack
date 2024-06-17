/* eslint-disable no-unused-vars */
import { z, ZodObject, ZodRawShape, ZodSchema, ZodTypeAny, ZodType } from 'zod';
import { Simplify, zInfer } from './utils/type-utils';

// Generic type for resolver functions
export type Resolver<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	TContext extends Record<string, any> | unknown = unknown,
> = (opts: {
	input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : null;
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

export type ActionDef<
	TResolver extends Resolver<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> = {
	inputSchema: TInputSchema;
	outputSchema: TOutputSchema;
	resolver: TResolver;
	type: TType;
	middleware: Middleware<TContext, TContext>[];
};

const initialDef = {
	inputSchema: undefined,
	outputSchema: undefined,
	resolver: undefined,
	type: undefined,
	middleware: [] as Middleware<any, any>[],
};

export function action<
	TContext extends Record<string, any> | unknown = unknown,
>() {
	function createBuilder<
		TInputSchema extends ZodTypeAny | undefined,
		TOutputSchema extends ZodTypeAny | undefined,
		TType extends 'mutation' | 'query' | undefined,
		TContextOverride extends Record<string, any> | unknown = unknown,
	>(
		def: ActionDef<any, TInputSchema, TOutputSchema, TType, TContextOverride>
	): ActionBuilder<TInputSchema, TOutputSchema, TType, TContextOverride> {
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
			output<TNewOutput extends ZodTypeAny>(schema: TNewOutput) {
				return createBuilder({
					...def,
					outputSchema: schema,
				});
			},

			use<TNewContext extends TContextOverride>(
				middleware: Middleware<TContextOverride, TNewContext>
			) {
				return createBuilder({
					...def,
					// @ts-expect-error
					middleware: [...def.middleware, middleware],
				}) as unknown as ActionBuilder<
					TInputSchema,
					TOutputSchema,
					TType,
					TNewContext
				>;
			},
			mutation<
				TResolver extends Resolver<
					TInputSchema,
					TOutputSchema,
					TContextOverride
				>,
			>(resolver: TResolver) {
				const newDef: ActionDef<
					TResolver,
					TInputSchema,
					TOutputSchema,
					'mutation',
					TContextOverride
				> = {
					...def,
					resolver,
					type: 'mutation',
				};
				return createAction(newDef) as unknown as Action<
					TResolver,
					TInputSchema,
					TOutputSchema,
					'mutation',
					TContextOverride
				>;
			},
			query<
				TResolver extends Resolver<
					TInputSchema,
					TOutputSchema,
					TContextOverride
				>,
			>(resolver: TResolver) {
				const newDef: ActionDef<
					TResolver,
					TInputSchema,
					TOutputSchema,
					'query',
					TContextOverride
				> = {
					...def,
					resolver,
					type: 'query',
				};
				return createAction(newDef) as unknown as Action<
					TResolver,
					TInputSchema,
					TOutputSchema,
					'query',
					TContextOverride
				>;
			},
		};
	}

	return createBuilder<undefined, any, any, TContext>({
		...initialDef,
	});
}

export interface ActionBuilder<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> {
	input: <TNewInputSchema extends ZodSchemaOrRawShape>(
		schema: TNewInputSchema
	) => ActionBuilder<
		InferZodSchemaOrRawShape<TNewInputSchema>,
		TOutputSchema,
		TType,
		TContext
	>;
	output: <TNewOutput extends ZodTypeAny>(
		schema: TNewOutput
	) => ActionBuilder<TInputSchema, TNewOutput, TType, TContext>;
	use: <TNewContext extends TContext>(
		middleware: Middleware<TContext, TNewContext>
	) => ActionBuilder<TInputSchema, TOutputSchema, TType, TNewContext>;

	mutation: <TResolver extends Resolver<TInputSchema, TOutputSchema, TContext>>(
		resolver: TResolver
	) => Action<TResolver, TInputSchema, TOutputSchema, 'mutation', TContext>;
	query: <TResolver extends Resolver<TInputSchema, TOutputSchema, TContext>>(
		resolver: TResolver
	) => Action<TResolver, TInputSchema, TOutputSchema, 'query', TContext>;
}

export type Action<
	TResolver extends Resolver<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> = ActionDef<TResolver, TInputSchema, TOutputSchema, TType, TContext> & {
	raw: (
		ctx: TContext,
		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : void
	) => Simplify<ReturnType<TResolver>>;
} & ((
		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : void
	) => ReturnType<TResolver>);

//

export function createAction<
	TResolver extends Resolver<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined,
	TType extends 'mutation' | 'query',
	TContext extends Record<string, any> | unknown,
>(def: ActionDef<TResolver, TInputSchema, TOutputSchema, TType, TContext>) {
	/**
	 * Invokes the resolver with middleware logic
	 */
	const invokeWithMiddleware = async (
		ctx: TContext,
		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : null,
		middlewares: Middleware<TContext, TContext>[] = def.middleware
	) => {
		let currentCtx = ctx;

		const executeMiddleware = async (index: number): Promise<any> => {
			if (index >= middlewares.length) {
				return def.resolver({ input, ctx: currentCtx });
			} else {
				const currentMiddleware = middlewares[index];
				return await currentMiddleware({
					ctx: currentCtx,
					next: async (newCtx?: TContext) => {
						currentCtx = newCtx || currentCtx;
						return executeMiddleware(index + 1);
					},
				});
			}
		};

		return executeMiddleware(0);
	};

	/**
	 * Invokes the resolver without parsing input/output
	 * Useful for raw calls from the backend
	 */
	const rawCall = async (
		ctx: TContext,
		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : null
	) => {
		return invokeWithMiddleware(ctx, input);
	};

	/**
	 * Invokes the resolver with parsing input/output and middleware logic
	 * Useful for safe calls from the frontend
	 */
	const safeCall = async (input: any) => {
		const maybeParsedInput = def.inputSchema
			? def.inputSchema.parse(input)
			: input;
		const result = await invokeWithMiddleware(
			undefined as any,
			maybeParsedInput
		);

		const maybeParsedOutput = def.outputSchema
			? def.outputSchema.parse(result)
			: result;
		return maybeParsedOutput;
	};

	return Object.assign(safeCall, def, { raw: rawCall });
}
