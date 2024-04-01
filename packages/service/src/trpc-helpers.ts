/* eslint-disable no-unused-vars */
import {
	MutationProcedure,
	QueryProcedure,
} from '@trpc/server/unstable-core-do-not-import';
import { z, ZodError, ZodTypeAny } from 'zod';
import { zInfer } from './utils/type-utils';

import { Resolver, Service } from './service';
import { initTRPC, TRPCError } from '@trpc/server';
import SuperJSON from 'superjson';

const getTrpc = <TContext extends object>() => {
	return initTRPC.context<TContext>().create({
		transformer: SuperJSON,
		errorFormatter({ shape, error }) {
			return {
				...shape,
				data: {
					...shape.data,
					zodError:
						error.cause instanceof ZodError ? error.cause.flatten() : null,
				},
			};
		},
	});
};

// export const createRouter = t.router;
// export const createProcedure = t.procedure;
// export const createCallerFactory = t.createCallerFactory;

// export function createTrpcProcedureFromService<
// 	TResolver extends Resolver<any, any>,
// 	TInputSchema extends ZodTypeAny | undefined,
// 	TOutputSchema extends ZodTypeAny | undefined,
// 	TType extends 'mutation' | 'query',
// 	TContext extends unknown = unknown,
// >(service: Service<TResolver, TInputSchema, TOutputSchema, TType, TContext>) {
// 	if (!service.resolver) {
// 		throw new Error('Resolver not defined');
// 	}

// 	type InputOutput = {
// 		input: TInputSchema extends ZodTypeAny ? zInfer<TInputSchema> : void;
// 		output: ReturnType<TResolver> extends Promise<infer TOutput>
// 			? TOutput
// 			: never;
// 	};

// 	type ProcedureResult = TType extends 'mutation'
// 		? MutationProcedure<InputOutput>
// 		: QueryProcedure<InputOutput>;

// 	const inputSchema = service.inputSchema ?? z.void();

// 	const t = getTrpc<TContext extends object ? TContext : object>();

// 	const procedure = t.procedure;

// 	if (service.type === 'mutation') {
// 		return procedure.input(inputSchema).mutation(({ ctx, input }) => {
// 			// @ts-expect-error
// 			return service.callerWithoutParser(ctx, input);
// 		}) as unknown as ProcedureResult;
// 	}

// 	if (service.type === 'query')
// 		return procedure.input(inputSchema).query(({ ctx, input }) => {
// 			// @ts-expect-error
// 			return service.callerWithoutParser(ctx, input);
// 		}) as unknown as ProcedureResult;

// 	throw new Error('Type not defined');
// }

export function createTrpcProcedureFromService<
	TService extends Service<any, any, any, any, any>,
>(service: TService) {
	if (!service.resolver) {
		throw new Error('Resolver not defined');
	}

	type InputOutput = {
		input: TService['inputSchema'] extends ZodTypeAny
			? zInfer<TService['inputSchema']>
			: void;
		output: ReturnType<TService['resolver']> extends Promise<infer TOutput>
			? TOutput
			: never;
	};

	type ProcedureResult = TService['type'] extends 'mutation'
		? MutationProcedure<InputOutput>
		: QueryProcedure<InputOutput>;

	const inputSchema = service.inputSchema ?? z.void();
	const t =
		getTrpc<
			TService['middleware'] extends object ? TService['middleware'] : object
		>();
	const procedure = t.procedure;

	if (service.type === 'mutation') {
		return procedure.input(inputSchema).mutation(({ ctx, input }) => {
			return service.callerWithoutParser(ctx, input);
		}) as unknown as ProcedureResult;
	}

	if (service.type === 'query') {
		return procedure.input(inputSchema).query(({ ctx, input }) => {
			return service.callerWithoutParser(ctx, input);
		}) as unknown as ProcedureResult;
	}

	throw new Error('Type not defined');
}

export function createManyTrpcProceduresFromServices<
	TServiceMap extends Record<string, Service<any, any, any, any, any>>,
>(serviceMap: TServiceMap) {
	type ServiceKeys = keyof TServiceMap;
	type Procedures = {
		[K in ServiceKeys]: ReturnType<
			typeof createTrpcProcedureFromService<TServiceMap[K]>
		>;
	};
	const procedures = Object.entries(serviceMap).reduce(
		(acc, [key, service]) => {
			acc[key as ServiceKeys] = createTrpcProcedureFromService(
				service
			) as Procedures[ServiceKeys];
			return acc;
		},
		{} as Procedures
	);

	return procedures;
}

export function createTrpcRouterFromServices<
	TServiceMap extends Record<string, Service<any, any, any, any, any>>,
>(serviceMap: TServiceMap) {
	const procedures = createManyTrpcProceduresFromServices(serviceMap);
	return getTrpc().router(procedures);
}

// export function createServicesRouter<
//   TServiceObjectMap extends Record<
//     string,
//     Record<string, Service<any, any, any, any, any>>
//   >,
// >(services: TServiceObjectMap) {
//   type ServiceObjKeys = keyof TServiceObjectMap;
//   type Routers = {
//     [K in ServiceObjKeys]: ReturnType<
//       typeof createServiceRouter<TServiceObjectMap[K]>
//     >;
//   };

//   const routers = Object.entries(services).reduce((acc, [key, service]) => {
//     acc[key as ServiceObjKeys] = createServiceRouter(
//       service,
//     ) as Routers[ServiceObjKeys];
//     return acc;
//   }, {} as Routers);

//   return createRouter(routers);
// }

/**
 * export const services = {
  field: fieldService,
  metric: metricLogService,
  ritual: ritualService,
  metricLog: metricLogService,
};

// export const serviceRouter = createRouter({
//   field: createServiceRouter(fieldService),
//   metric: createServiceRouter(metricLogService),
//   ritual: createServiceRouter(ritualService),
//   metricLog: createServiceRouter(metricLogService),
// });



 */
