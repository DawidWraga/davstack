import { postRouter } from "@/server/api/routers/post";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { todoServices } from "@/server/services";
import { createTrpcRouterFromServices } from "@davstack/service";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  todo: createTrpcRouterFromServices(todoServices),
});

// appRouter.todo

// export type definition of API
export type AppRouter = typeof appRouter;
