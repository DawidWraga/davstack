import { todoServices } from "@/api/services";
import { createTRPCRouter } from "@/lib/trpc";
import { createTrpcRouterFromServices } from "@davstack/service";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const apiRouter = createTRPCRouter({
  todo: createTrpcRouterFromServices(todoServices),
});

// export type definition of API
export type ApiRouter = typeof apiRouter;

// type temp = ApiRouter['todo'][]
