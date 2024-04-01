/* eslint-disable no-unused-vars */
import {
	z,
	// infer as _infer,
	ZodObject,
	ZodRawShape,
	ZodSchema,
	ZodTypeAny,
	ZodType,
} from 'zod';
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

// Define the builder interface capturing generic types for input and output

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

export type ServiceDef<
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

export function service<
	TContext extends Record<string, any> | unknown = unknown,
>() {
	function createBuilder<
		TInputSchema extends ZodTypeAny | undefined,
		TOutputSchema extends ZodTypeAny | undefined,
		TType extends 'mutation' | 'query' | undefined,
		TContextOverride extends Record<string, any> | unknown = unknown,
	>(
		def: ServiceDef<any, TInputSchema, TOutputSchema, TType, TContextOverride>
	): ServiceBuilder<TInputSchema, TOutputSchema, TType, TContextOverride> {
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
				}) as unknown as ServiceBuilder<
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
				const newDef: ServiceDef<
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
				return createResolver(newDef) as unknown as Service<
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
				const newDef: ServiceDef<
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
				return createResolver(newDef) as unknown as Service<
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
export interface ServiceBuilder<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> {
	input: <TNewInputSchema extends ZodSchemaOrRawShape>(
		schema: TNewInputSchema
	) => ServiceBuilder<
		InferZodSchemaOrRawShape<TNewInputSchema>,
		TOutputSchema,
		TType,
		TContext
	>;
	output: <TNewOutput extends ZodTypeAny>(
		schema: TNewOutput
	) => ServiceBuilder<TInputSchema, TNewOutput, TType, TContext>;
	use: <TNewContext extends TContext>(
		middleware: Middleware<TContext, TNewContext>
	) => ServiceBuilder<TInputSchema, TOutputSchema, TType, TNewContext>;

	mutation: <TResolver extends Resolver<TInputSchema, TOutputSchema, TContext>>(
		resolver: TResolver
	) => Service<TResolver, TInputSchema, TOutputSchema, 'mutation', TContext>;
	query: <TResolver extends Resolver<TInputSchema, TOutputSchema, TContext>>(
		resolver: TResolver
	) => Service<TResolver, TInputSchema, TOutputSchema, 'query', TContext>;
}

export type Service<
	TResolver extends Resolver<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined | unknown,
	TType extends 'mutation' | 'query' | undefined,
	TContext extends Record<string, any> | unknown = unknown,
> = ServiceDef<TResolver, TInputSchema, TOutputSchema, TType, TContext> & {
	(
		ctx: TContext,
		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : void
	): ReturnType<TResolver>;
};
export function createResolver<
	TResolver extends Resolver<any, any, any>,
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny | undefined,
	TType extends 'mutation' | 'query',
	TContext extends Record<string, any> | unknown,
>(def: ServiceDef<TResolver, TInputSchema, TOutputSchema, TType, TContext>) {
	/**
	 * Invokes the resolver with middleware logic
	 */
	const callerWithMiddleware = async (
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
	 * Calls the resolver function without parsing input/output
	 * Useful for calling the resolver when the input/output is already parsed
	 */
	const callerWithoutParser = async (
		ctx: TContext,
		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : null
	) => {
		return callerWithMiddleware(ctx, input);
	};

	/**
	 * Invokes the resolver with parsing input/output and middleware logic
	 * Useful for safe calling the resolver directly
	 */
	const callerWithParser = async (ctx: TContext, input: any) => {
		const maybeParsedInput = def.inputSchema
			? def.inputSchema.parse(input)
			: input;
		const result = await callerWithMiddleware(ctx, maybeParsedInput);

		const maybeParsedOutput = def.outputSchema
			? def.outputSchema.parse(result)
			: result;
		return maybeParsedOutput;
	};

	return Object.assign(callerWithParser, def, { callerWithoutParser });
}
