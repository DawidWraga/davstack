import "server-only";
import { headers } from "next/headers";
import { cache } from "react";

import { apiRouter } from "@/api/router";
import { createCallerFactory } from "@/lib/trpc";
import { createServiceContext } from "@/lib/service";

/**
 * Can either use the tRPC API or the services directly.
 *
 * When using services directly, need to pass ctx to the service calls.
 *
 * When using the tRPC API, the context is automatically passed to the service calls.
 *
 * After some testing, it seems that tRPC does *not* lead to redundant api when using  the ssr api caller in the react server component.
 *
 */

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
