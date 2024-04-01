import { service } from "@davstack/service";

import { getServerAuthSession } from "@/server/auth";
import { db } from "@/server/db";
import { type User } from "next-auth";

export const createServiceContext = async (opts: { headers: Headers }) => {
  const session = await getServerAuthSession();

  const user = session?.user;

  return {
    db,
    user,
    ...opts,
  };
};

type WithUser<T> = Omit<T, "user"> & { user: { id: string } };

export type ServiceContext = Awaited<ReturnType<typeof createServiceContext>>;
export type ServiceContextAuthed = WithUser<ServiceContext>;

export const publicService = service<ServiceContext>();

export const authedService = service<ServiceContextAuthed>().use(
  async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new Error("Unauthorized");
    }
    return next({
      ...ctx,
      user: ctx.user as User,
    });
  },
);
