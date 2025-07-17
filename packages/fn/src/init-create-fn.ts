import { ZodTypeAny } from 'zod';
import { createFn, FnDef, FnHandler, Fn } from './create-fn';

// Middleware type that preserves handler types
export type Middleware<
	TContext extends Record<string, any> | unknown = unknown,
> = <TInputSchema extends ZodTypeAny | undefined, TOutput>(
	def: FnDef<
		TContext,
		TInputSchema,
		any,
		FnHandler<TContext, TInputSchema, TOutput>
	>,
	handler: FnHandler<TContext, TInputSchema, TOutput>
) => FnHandler<TContext, TInputSchema, TOutput>;

// Helper to create properly typed middleware
export function createMiddleware<
	TContext extends Record<string, any> | unknown = unknown,
>(middlewareFn: Middleware<TContext>): Middleware<TContext> {
	return middlewareFn;
}

// Factory function type that creates functions and has a use method
export interface FnFactory<
	TContext extends Record<string, any> | unknown = unknown,
> {
	// Method to add middleware
	use<TNewContext extends TContext = TContext>(
		middleware: Middleware<TNewContext>
	): FnFactory<TNewContext>;

	// Method to create a function
	create<
		TInputSchema extends ZodTypeAny | undefined = undefined,
		TOutputSchema extends ZodTypeAny | undefined | unknown = undefined,
		TOutput = any,
	>(
		def: Omit<
			FnDef<
				TContext,
				TInputSchema,
				TOutputSchema,
				FnHandler<TContext, TInputSchema, TOutput>
			>,
			'handler'
		> & {
			handler: FnHandler<TContext, TInputSchema, TOutput>;
		}
	): Fn<
		TContext,
		TInputSchema,
		TOutputSchema,
		FnHandler<TContext, TInputSchema, TOutput>
	>;
}

// Internal implementation function
function createFnFactory<
	TContext extends Record<string, any> | unknown = unknown,
>(middlewares: Middleware<any>[] = []): FnFactory<TContext> {
	return {
		use<TNewContext extends TContext = TContext>(
			middleware: Middleware<TNewContext>
		): FnFactory<TNewContext> {
			return createFnFactory<TNewContext>([...middlewares, middleware]);
		},

		create<
			TInputSchema extends ZodTypeAny | undefined = undefined,
			TOutputSchema extends ZodTypeAny | undefined | unknown = undefined,
			TOutput = any,
		>(
			def: Omit<
				FnDef<
					TContext,
					TInputSchema,
					TOutputSchema,
					FnHandler<TContext, TInputSchema, TOutput>
				>,
				'handler'
			> & {
				handler: FnHandler<TContext, TInputSchema, TOutput>;
			}
		): Fn<
			TContext,
			TInputSchema,
			TOutputSchema,
			FnHandler<TContext, TInputSchema, TOutput>
		> {
			// Apply middlewares in reverse order (last middleware wraps first)
			const composedHandler = middlewares.reduceRight(
				(handler, middleware) => middleware(def as any, handler),
				def.handler
			);

			return createFn<
				TContext,
				TInputSchema,
				TOutputSchema,
				typeof composedHandler
			>({
				...def,
				handler: composedHandler,
			});
		},
	};
}

// Primary initialization function - supports both array and builder patterns
export function initCreateFn<
	TContext extends Record<string, any> | unknown = unknown,
>(middlewares?: Middleware<TContext>[]): FnFactory<TContext> {
	return createFnFactory<TContext>(middlewares || []);
}
