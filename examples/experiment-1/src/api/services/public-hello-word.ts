import { publicService } from "@/lib/service";

export const publicHelloWorld = publicService.query(async () => {
  return { greeting: "Hello, world!" };
});
