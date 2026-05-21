import { api } from "@/api/react-ssr";
import { publicHelloWorld } from "@/api/services/public-hello-word";

export interface ServerApiCallerDemoProps {}

export async function ServerApiCallerDemo(props: ServerApiCallerDemoProps) {
  const {} = props;

  /**
   * Can either use the tRPC API or the services directly.
   *
   * When using services directly, need to pass ctx to the service calls.
   *
   * When using the tRPC API, the context is automatically passed to the service calls.
   *
   * After some testing, it seems that tRPC does *not* lead to redundant api when using  the ssr api caller in the react server component.
   *
   */

  const hello = await api.other.publicHelloWorld();

  // alternative way to call the service directly:
  // const ctx = createServiceContext();
  // const hello = await publicHelloWorldWorld(ctx);

  return <div>server api caller demo: {hello.greeting}</div>;
}
