"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/trpc/react";
import { useSession } from "next-auth/react";

export interface CrudDemoProps {}

export function CrudDemo(props: CrudDemoProps) {
  const { data: session } = useSession();
  const isAuthed = !!session?.user;
  const {
    data: latestPost,
    isPending,
    error,
  } = api.post.getLatest.useQuery(undefined, {
    enabled: isAuthed,
  });

  if (!isAuthed) return <>Sign in to see crud demo</>;

  if (error) {
    return (
      <div className="rounded bg-red-500 p-4 text-white">
        <p className="font-bold">Error</p>
        <pre>{JSON.stringify(error, null, 4)}</pre>
      </div>
    );
  }

  if (isPending) {
    return <p>Loading...</p>;
  }

  return (
    <div className="w-full max-w-xs">
      {latestPost ? (
        <p className="truncate">Your most recent post: {latestPost?.name}</p>
      ) : (
        <p>You have no posts yet.</p>
      )}

      <CreatePost />
    </div>
  );
}

export function CreatePost() {
  const router = useRouter();
  const [name, setName] = useState("");

  const createPost = api.post.create.useMutation({
    onSuccess: () => {
      router.refresh();
      setName("");
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        createPost.mutate({ name });
      }}
      className="flex flex-col gap-2"
    >
      <input
        type="text"
        placeholder="Title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-full px-4 py-2 text-black"
      />
      <button
        type="submit"
        className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
        disabled={createPost.isPending}
      >
        {createPost.isPending ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
