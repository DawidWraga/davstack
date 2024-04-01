import { z } from "zod";

import { authedService } from "@/server/service";

export const getTodos = authedService.query(async ({ ctx }) => {
  return ctx.db.todo.findMany({
    where: {
      createdBy: { id: ctx.user.id },
    },
  });
});

export const createTodo = authedService
  .input(z.object({ name: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    return ctx.db.todo.create({
      data: {
        name: input.name,
        createdBy: { connect: { id: ctx.user.id } },
      },
    });
  });
