import { api } from "@/trpc/server";

export interface ServerApiCallerProps {}

export async function ServerApiCaller(props: ServerApiCallerProps) {
  const {} = props;

  const hello = await api.post.hello({ text: "from tRPC" });

  return (
    <div className=" ">
      server api caller demo:
      <p className="text-2xl text-white">
        {hello ? hello.greeting : "Loading tRPC query..."}
      </p>
    </div>
  );
}
