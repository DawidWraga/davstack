import Link from "next/link";

import { getServerAuthSession } from "@/server/auth";

export interface ServerSessionDemoProps {}

export async function ServerSessionDemo(props: ServerSessionDemoProps) {
  const {} = props;

  const session = await getServerAuthSession();

  return (
    <div>
      server auth session demo:
      <div className="flex items-center gap-1">
        <p className="flex-1 text-center  text-white">
          {session && <span>Logged in as {session.user?.name}</span>}
        </p>
        <Link
          href={session ? "/api/auth/signout" : "/api/auth/signin"}
          className="rounded-full bg-white/10 px-3 py-2 font-semibold no-underline transition hover:bg-white/20"
        >
          {session ? "Sign out" : "Sign in"}
        </Link>
      </div>
    </div>
  );
}
