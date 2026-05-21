"use server";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { todoServices } from "@/api/services";
import * as publicHelloWorldServices from "@/api/services/public-hello-word";
import { ServiceContext } from "@/lib/service";
import { createTrpcRouterFromServices, getTrpc } from "@davstack/service";

// can use existing trpc instance and existing createTrpcRouter function
// otherwise this default is provided by the service package
const t = getTrpc<ServiceContext>();

/**
 * This is the primary router for your server.
 */
export const apiRouter = t.router({
  todo: createTrpcRouterFromServices(todoServices),
  other: createTrpcRouterFromServices(publicHelloWorldServices),
});

// export type definition of API
export type ApiRouter = typeof apiRouter;
