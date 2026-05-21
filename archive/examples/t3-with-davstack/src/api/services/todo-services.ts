"use server";
import { z } from "zod";

import { authedService, publicService } from "@/lib/service";

export const getTodos = authedService.query(async ({ ctx }) => {
  return ctx.db.todo.findMany({
    where: {
      createdBy: { id: ctx.user?.id },
    },
  });
});

export const createTodo = authedService
  .input({ name: z.string().min(1) })
  .mutation(async ({ ctx, input }) => {
    return ctx.db.todo.create({
      data: {
        name: input.name,
        createdBy: { connect: { id: ctx.user.id } },
      },
    });
  });

export const updateTodo = authedService
  .input({
    id: z.string(),
    completed: z.boolean().optional(),
    name: z.string().optional(),
  })
  .mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    return ctx.db.todo.update({
      where: { id },
      data,
    });
  });

export const deleteTodo = authedService
  .input({ id: z.string() })
  .mutation(async ({ ctx, input }) => {
    return ctx.db.todo.delete({ where: { id: input.id } });
  });
