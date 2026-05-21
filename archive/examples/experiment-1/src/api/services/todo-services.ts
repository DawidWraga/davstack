import { z } from "zod";

import { upsertMany } from "@/lib/prisma-utils";
import { authedService } from "@/lib/service";

export const getTodos = authedService
  .input(
    z
      .object({
        ids: z.array(z.string()).optional(),
      })
      .optional(),
  )
  .query(async ({ ctx, input }) => {
    return ctx.db.todo.findMany({
      where: {
        createdBy: { id: ctx.user?.id },
        ...(input?.ids && {
          id: { in: input.ids },
        }),
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

export const upsertTodo = authedService
  .input({
    id: z.string().optional(),
    name: z.string().min(1),
    completed: z.boolean().optional(),
  })
  .mutation(async ({ ctx, input }) => {
    const { id, ...data } = input;
    return ctx.db.todo.upsert({
      where: { id },
      update: data,
      create: {
        ...data,
        createdBy: { connect: { id: ctx.user.id } },
      },
    });
  });

export const deleteTodo = authedService
  .input({ id: z.string() })
  .mutation(async ({ ctx, input }) => {
    return ctx.db.todo.delete({ where: { id: input.id } });
  });

export const deleteManyTodos = authedService
  .input({ ids: z.array(z.string()) })
  .mutation(async ({ ctx, input }) => {
    return ctx.db.todo.deleteMany({ where: { id: { in: input.ids } } });
  });

export const syncLocalTodosToDb = authedService
  .input({
    todos: z.array(
      z.object({ id: z.string(), name: z.string(), completed: z.boolean() }),
    ),
  })
  .mutation(async ({ ctx, input }) => {
    const todos = input.todos.map((todo) => ({
      ...todo,
      createdById: ctx.user.id,
      updatedAt: new Date(),
    }));

    // Upsert all todos in a single query
    const upsertedTodos = await upsertMany(ctx.db, {
      tableName: "Todo",
      values: todos,
    });

    const deletedTodos = await ctx.db.todo.deleteMany({
      where: {
        NOT: {
          id: {
            in: todos.map((todo) => todo.id),
          },
        },
      },
    });

    return { upsertedTodos, deletedTodos };
  });
