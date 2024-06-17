"use server";

import { unstable_cache } from 'next/cache';
import { authedAction } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export const getTodos = authedAction.query(async ({ ctx }) => {
  return ctx.db.todo.findMany({
    where: {
      createdBy: { id: ctx.user.id },
    },
  });
});

export const createTodo = authedAction
  .input({ name: z.string().min(1) })
  .mutation(async ({ ctx, input }) => {
    return ctx.db.todo
      .create({
        data: {
          name: input.name,
          createdBy: { connect: { id: ctx.user.id } },
        },
      })
      .then(() => {
        // revalidatePath("/with-server-actions");
      });
  });

export const updateTodo = authedAction
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

export const deleteTodo = authedAction
  .input({ id: z.string() })
  .mutation(async ({ ctx, input }) => {
    return ctx.db.todo.delete({ where: { id: input.id } });
  });
