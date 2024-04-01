import { z } from "zod";

import { db } from "@/server/db";
import { authedService } from "@/server/service";

// export const getTodos = authedService.query(({ ctx }) => {
//   retr
//   // return ctx.db.todo.findMany();
// });

// export const createTodo = authedService
//   .input(z.object({ name: z.string().min(1) }))
//   .mutation(async ({ ctx, input }) => {
//     return 1;
//     // simulate a slow db call
//     // await new Promise((resolve) => setTimeout(resolve, 1000));
//     // return db.todo.create({
//     //   data: {
//     //     name: input.name,
//     //     createdBy: { connect: { id: ctx.user?.id } },
//     //   },
//     // });
//   });

export const getLatestTodo = authedService.query(async ({ ctx }) => {
  return 1;
  // return db.todo.findFirst({
  //   orderBy: { createdAt: "desc" },
  //   where: { createdBy: { id: ctx.user?.id } },
  // });
});
