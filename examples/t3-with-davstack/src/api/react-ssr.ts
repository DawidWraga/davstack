import "server-only";

/**
 * could delete this file and use the services directly in the RSC.
 *
 * When using services directly, need to pass ctx to the service calls.
 *
 * When using the tRPC API, the context is automatically passed to the service calls.
 *
 * However the tTRPC caller may lead to redundant api requests- need to check if the caller will use the default next.js server actions / react server compoennts as the transport layer, or whether it will send a request to /api/trpc (redundant api request)
 */

import { headers } from "next/headers";
import { cache } from "react";

import { apiRouter } from "@/api/router";
import { createCallerFactory } from "@/lib/trpc";
import { createServiceContext } from "@/lib/service";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(() => {
  const heads = new Headers(headers());
  heads.set("x-trpc-source", "rsc");

  return createServiceContext({
    headers: heads,
  });
});

export const api = createCallerFactory(apiRouter)(createContext);
