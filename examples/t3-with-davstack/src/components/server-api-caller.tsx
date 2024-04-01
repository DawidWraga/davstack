import { api } from "@/api/react-ssr";
import { publicHelloWorld } from "@/api/services/public-hello-word";

export interface ServerApiCallerProps {}

export async function ServerApiCaller(props: ServerApiCallerProps) {
  const {} = props;

  // const hello = await api.post.hello({ text: "from tRPC" });

  const hello = await publicHelloWorld({} as any);

  return (
    <div >
      server api caller demo: {hello ? hello.greeting : "Loading tRPC query..."}
    </div>
  );
}
