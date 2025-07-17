import {
	AnyProcedureBuilder,
	MutationProcedure,
	QueryProcedure,
} from '@trpc/server/unstable-core-do-not-import';
import { z, ZodTypeAny } from 'zod';
import { Fn, zInfer } from '..';

/**
 * Creates a factory function for tRPC procedures from Fn definitions
 *
 * @remarks
 * This function deliberately uses a more flexible type definition than the full Fn type
 * to avoid complex type compatibility issues between context types and middleware.
 *
 * Prior to introducing OptionallyRequiredField, using Fn<any,any,any,any,any> worked fine,
 * but after adding that type helper, we encountered type compatibility issues with our more
 * structured argument types.
 *
 * We're extracting only the essential properties needed for procedure creation rather
 * than using the full Fn type to prevent TypeScript errors with OptionallyRequiredField
 * and context type constraints when used with specific service contexts.
 *
 * In the future, we could consider using FnDef instead of Fn as the constraint, as it
 * contains the definition properties without the call signatures that include the
 * OptionallyRequiredField complexity.
 *
 * The type safety for the actual function implementations is handled elsewhere in the
 * system, so this pragmatic approach allows us to create procedures without excessive
 * type gymnastics.
 */
export function initProcedureFactory<
	TProcedureBuilder extends AnyProcedureBuilder
>(procedureBuilder: TProcedureBuilder) {
	return function createTrpcProcedureFromFn<
		TFn extends {
			inputSchema?: ZodTypeAny;
			type?: 'mutation' | 'query';
			resolver: (...args: any[]) => Promise<any>;
		}
	>(fn: TFn & { (...args: any[]): Promise<any> }) {
		if (!fn.resolver) {
			throw new Error('Resolver not defined');
		}

		type InputType = TFn['inputSchema'] extends ZodTypeAny
			? zInfer<TFn['inputSchema']>
			: void;

		type OutputType = ReturnType<TFn['resolver']> extends Promise<infer TOutput>
			? TOutput
			: never;

		type InputOutput = {
			input: InputType;
			output: OutputType;
		};

		type ProcedureResult = TFn['type'] extends 'mutation'
			? MutationProcedure<InputOutput>
			: QueryProcedure<InputOutput>;

		const inputSchema = fn.inputSchema ?? z.void();
		// TODO: Potentially integrate outputSchema validation in the future

		// Define the handler function that will be used for both query and mutation
		// This avoids duplicating the implementation and creating different stack frames
		const handler = async ({ ctx, input }: { ctx: any; input: any }) => {
			try {
				// Directly call the function to avoid introducing unnecessary stack frames
				return await fn({ input, ctx });
			} catch (error) {
				// Don't wrap the error here - let it propagate with its original stack
				throw error;
			}
		};

		if (fn.type === 'mutation') {
			return procedureBuilder
				.input(inputSchema)
				.mutation(handler) as unknown as ProcedureResult;
		}

		if (fn.type === 'query') {
			return procedureBuilder
				.input(inputSchema)
				.query(handler) as unknown as ProcedureResult;
		}

		throw new Error('Type not defined');
	};
}
