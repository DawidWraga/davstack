import { z } from 'zod';
import type {
	Builder,
	ProcedureBuilder,
	DecoratedProcedure,
	Schema,
} from '@orpc/server';
import { zInferInput, zInfer, ZodTypeAny, Simplify } from '@davstack/fn';

/**
 * Creates a factory function for oRPC procedures from Fn definitions.
 *
 * @remarks
 * This function deliberately uses a more flexible type definition than the full
 * Fn type to avoid complex type compatibility issues between context types and
 * middleware, mirroring the approach used by `@davstack/fn-trpc`.
 *
 * We extract only the essential properties needed for procedure creation
 * (`inputSchema`, `outputSchema`, `handler`) rather than using the full Fn type
 * to prevent TypeScript errors with context type constraints when used with
 * specific service contexts.
 *
 * Unlike the tRPC adapter, oRPC has no query/mutation distinction at the builder
 * level (that is a `.route({ method })` concern), so this factory takes only the
 * fn — call `.route(...)` on the returned procedure if you need OpenAPI metadata.
 *
 * The type safety for the actual function implementations is handled elsewhere in
 * the system, so this pragmatic approach allows us to create procedures without
 * excessive type gymnastics.
 *
 * @param procedureBuilder - An oRPC `Builder` or `ProcedureBuilder`, e.g. `os`
 *   or `os.$context<MyCtx>()`.
 */
export function initProcedureFactory<
	TProcedureBuilder extends
		| Builder<any, any, any, any, any, any>
		| ProcedureBuilder<any, any, any, any, any, any>,
>(procedureBuilder: TProcedureBuilder) {
	return function createOrpcProcedureFromFn<
		TFn extends {
			inputSchema?: ZodTypeAny;
			outputSchema?: ZodTypeAny;
			handler: (...args: any[]) => any;
		} & ((...args: any[]) => Promise<any>),
	>(fn: TFn) {
		if (!fn.handler) {
			throw new Error('Handler not defined');
		}

		type InputType = TFn['inputSchema'] extends ZodTypeAny
			? Simplify<zInferInput<TFn['inputSchema']>>
			: void;

		// Prefer the declared output schema for the output type when present,
		// otherwise fall back to the fn's resolved return type. We read this from
		// the fn's own call signature (`Awaited<ReturnType<TFn>>`) rather than
		// `TFn['handler']`, because the handler property on a createFn result is
		// typed generically (FnHandler<...>) and does not carry the concrete
		// return type, whereas the callable signature does.
		type OutputType = TFn['outputSchema'] extends ZodTypeAny
			? zInfer<TFn['outputSchema']>
			: Awaited<ReturnType<TFn>>;

		// A clean oRPC procedure result type with input/output inference wired up.
		// oRPC infers client input/output from the schema generics, where a
		// schema is a StandardSchemaV1<TInput, TOutput>, so we surface the fn's
		// resolved input/output types through those slots.
		type ProcedureResult = DecoratedProcedure<
			Record<never, never>,
			Record<never, never>,
			Schema<InputType, InputType>,
			Schema<OutputType, OutputType>,
			Record<never, never>,
			Record<never, never>
		>;

		const inputSchema = (fn.inputSchema ?? z.void()) as ZodTypeAny;

		// Map oRPC's `context` to fn's `ctx`. Call the fn directly so the
		// original FnError (and its stack) propagate unchanged.
		const handler = async ({
			input,
			context,
		}: {
			input: any;
			context: any;
		}) => {
			return fn({ input, ctx: context });
		};

		const withInput = (procedureBuilder as any).input(inputSchema);

		const built = fn.outputSchema
			? withInput.output(fn.outputSchema).handler(handler)
			: withInput.handler(handler);

		return built as unknown as ProcedureResult;
	};
}
