// Cross-platform process-tree kill.
//
// Windows: shell out to `taskkill /T /F /PID <pid>`. `/T` kills the whole
// tree (parent + descendants); `/F` is force — `/T` without `/F` is
// unreliable. The Windows path ignores the signal argument by design — we
// always hard-terminate because Node's SIGTERM-on-Windows already maps to
// TerminateProcess anyway, so "graceful" SIGTERM doesn't exist for us.
//
// POSIX: best-effort `process.kill(pid, signal)` to the immediate child.
// We do NOT walk /proc — none of the davstack daemons fork grandchildren
// on Linux per the spawn audit, and kernel SIGTERM-to-PGID would require
// `detached:true` on spawn which we deliberately don't do.

import { exec } from "node:child_process"

export async function killTree(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      exec(`taskkill /T /F /PID ${pid}`, () => resolve())
    })
    return
  }
  try {
    process.kill(pid, signal)
  } catch {
    // Process already gone — nothing to do.
  }
}
