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

export const getTrpc = <TContext extends object>() => {
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

export function createTrpcProcedureFromService<
	TService extends Service<any, any, any, any, any>,
>(service: TService, customTrpc?: ReturnType<typeof getTrpc>) {
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
		customTrpc ??
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
>(serviceMap: TServiceMap, customTrpc?: ReturnType<typeof getTrpc>) {
	type ServiceKeys = keyof TServiceMap;
	type Procedures = {
		[K in ServiceKeys]: ReturnType<
			typeof createTrpcProcedureFromService<TServiceMap[K]>
		>;
	};
	const procedures = Object.entries(serviceMap).reduce(
		(acc, [key, service]) => {
			acc[key as ServiceKeys] = createTrpcProcedureFromService(
				service,
				customTrpc
			) as Procedures[ServiceKeys];
			return acc;
		},
		{} as Procedures
	);

	return procedures;
}

export function createTrpcRouterFromServices<
	TServiceMap extends Record<string, Service<any, any, any, any, any>>,
>(serviceMap: TServiceMap, customTrpc?: ReturnType<typeof getTrpc>) {
	const t = customTrpc ?? getTrpc();
	const procedures = createManyTrpcProceduresFromServices(serviceMap, t);
	return t.router(procedures);
}

/**
 * Started working on feature to create router from nested services object.
 * Not finished yet and currently not working so commented out.
 */

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
