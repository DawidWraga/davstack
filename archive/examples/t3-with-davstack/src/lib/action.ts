import { getServerAuthSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { action } from "@davstack/action";
import { type User } from "next-auth";

export const createActionCtx = async () => {
  const session = await getServerAuthSession();
  const user = session?.user;
  return { db, user };
};
export type PublicActionCtx = {
  user?: User;
  db: typeof db;
};

export const publicAction = action<PublicActionCtx>().use(
  async ({ ctx, next }) => {
    const nextCtx = await createActionCtx();
    return next({
      ...ctx,
      ...nextCtx,
    });
  },
);

export type AuthedActionCtx = {
  user: User;
  db: typeof db;
};

export const authedAction = action<AuthedActionCtx>().use(
  async ({ ctx, next }) => {
    const nextCtx = await createActionCtx();

    if (!nextCtx.user) {
      throw new Error("Unauthorized");
    }
    // return next()
    return next({
      ...ctx,
      ...nextCtx,
      user: nextCtx.user as User,
    });
  },
);
