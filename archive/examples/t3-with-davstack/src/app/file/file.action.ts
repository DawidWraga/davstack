"use server";
import { action, zodFile } from "@davstack/action";
export const uploadFile = action()
  .input({
    file: zodFile({ type: "*" }),
  })
  .mutation(async ({ input, ctx }) => {
    console.log("FILE UPLOADING! ", { input, ctx });
  });
