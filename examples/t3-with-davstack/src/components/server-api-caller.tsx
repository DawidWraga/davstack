import { api } from "@/api/react-ssr";
import { publicHelloWorld } from "@/api/services/public-hello-word";

export interface ServerApiCallerProps {}

export async function ServerApiCaller(props: ServerApiCallerProps) {
  const {} = props;

  // const hello = await api.post.hello({ text: "from tRPC" });

  const hello = await publicHelloWorld({} as any);

  return (
    <div className=" ">
      server api caller demo:
      <p className="text-2xl text-white">
        {hello ? hello.greeting : "Loading tRPC query..."}
      </p>
    </div>
  );
}
