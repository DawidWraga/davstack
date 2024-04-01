/* eslint-disable no-unused-vars */

import { describe, expect, test } from "vitest";

import { authedService, publicService } from "../src/server/service";
import { service } from "@davstack/service";

describe("service tests from within t3 app", () => {
  test("publicService should be defined", () => {
    expect(publicService).toBeDefined();
  });

  test("authedService should be defined", () => {
    expect(authedService).toBeDefined();
  });

  /**
   * added test as it was causing some bugs
   */
  describe("Should handle creating context from complex middlware types", async () => {
    // from next auth
    type User = {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };

    const getServerAuthSession = async () => {
      return undefined as { user: User } | undefined;
    };

    const db = {} as any;

    const createServiceContext = async (opts: { headers: Headers }) => {
      const session = await getServerAuthSession();

      const user = session?.user;

      return {
        db,
        user,
        ...opts,
      };
    };

    type WithUser<T> = Omit<T, "user"> & { user: { id: string } };

    type ServiceContext = Awaited<ReturnType<typeof createServiceContext>>;
    type ServiceContextAuthed = WithUser<ServiceContext>;

    const publicService = service<ServiceContext>();
    const authedService = service<ServiceContextAuthed>().use(
      async ({ ctx, next }) => {
        if (!ctx.user) {
          throw new Error("Unauthorized");
        }
        return next();
      },
    );

    const getLatestTodo = authedService.query(async ({ ctx }) => {
      return "hello" as const;
    });

    test("should be able to call directly - v2", async () => {
      const todo = await getLatestTodo({
        user: { id: "1" },
        db,
        headers: {} as any,
      });
      expect(todo).toStrictEqual("hello");
    });
  });
});
