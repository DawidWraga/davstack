// Shared daemon-restart helper used by vitest-server /
// logs-server `refresh --hard`. Sequences: record the prior PID via health →
// client-side shutdown → wait for the listening socket to release → spawn a
// detached `<execPath> <entry> serve …` → poll the daemon's health endpoint
// until a *different* PID answers.
//
// Health-PID verification is load-bearing: without it, the helper false-
// positives when the prior daemon never died (#60). We record the pre-
// shutdown pid via GET <healthPath>, then accept the post-spawn poll only
// when health.pid differs from the prior pid. The new pid is what we surface
// to the caller; spawn-returned `child.pid` is unreliable on Windows when
// we go through `cmd /c start` to force-detach a bun-hosted daemon.
//
// `process.execPath` is reused as the runtime so node-hosted daemons stay
// on node and bun-hosted ones (logs-server) stay on bun without needing
// to rediscover the bin shim.
//
// Loses the daemon's PID — that's the deliberate cost of --hard. The
// TUI's `davstack start` watcher reattaches on its next /health probe.

export type RestartTarget = {
  host: string;
  port: number;
};

export type RestartOpts = RestartTarget & {
  /** JS entry file (typically `process.argv[1]` from the caller). */
  entry: string;
  /** Args passed after `serve` to the new process. */
  serveArgs: string[];
  /** Health endpoint path (default `/health`). */
  healthPath?: string;
  /** Shutdown endpoint path (default `/shutdown`). */
  shutdownPath?: string;
  /** Total deadline for the new daemon to start answering health. */
  startupTimeoutMs?: number;
};

export type RestartResult = {
  ok: boolean;
  pid?: number;
  startupMs: number;
  error?: string;
};

export async function restartDaemon(opts: RestartOpts): Promise<RestartResult> {
  const t0 = Date.now();
  const target: RestartTarget = { host: opts.host, port: opts.port };
  const healthPath = opts.healthPath ?? '/health';
  const shutdownPath = opts.shutdownPath ?? '/shutdown';

  // Snapshot the current daemon PID before tearing it down. waitHealthy
  // uses this to detect the "old daemon never died" failure mode — without
  // it, the poll happily accepts a 200 from the surviving prior process.
  const priorPid = await fetchHealthPid(target, healthPath);

  await bestEffortShutdown(target, shutdownPath);
  // Wait for the old socket to release before re-binding. SO_REUSEADDR
  // semantics differ across platforms; on Windows in particular, immediate
  // re-bind can fail with EADDRINUSE.
  await waitPortClosed(target, 5000);

  const child = await spawnDetached(opts.entry, opts.serveArgs);
  const health = await waitHealthyFreshPid(
    target,
    healthPath,
    opts.startupTimeoutMs ?? 30_000,
    priorPid,
  );
  if (!health.ok) {
    return {
      ok: false,
      pid: child.pid,
      startupMs: Date.now() - t0,
      error: health.error,
    };
  }
  // Prefer the daemon-reported pid: under the `cmd /c start` Windows path,
  // child.pid is the throwaway cmd.exe, not the daemon.
  return { ok: true, pid: health.pid ?? child.pid, startupMs: Date.now() - t0 };
}

async function spawnDetached(
  entry: string,
  serveArgs: string[],
): Promise<{ pid: number | undefined }> {
  const { spawn } = await import('node:child_process');
  // `detached: true` + `stdio: 'ignore'` is enough for node-hosted daemons
  // on every platform. For bun-hosted daemons (logs-server) on Windows the
  // detach is unreliable — the child stays attached to the parent's console
  // session and dies when the CLI returns (#60). Wrapping in `cmd /c start
  // "" /B` forces a clean Windows detach via the shell's start verb. The
  // returned child.pid is cmd.exe, which exits immediately; the daemon's
  // real pid is read off /health by waitHealthyFreshPid.
  if (process.platform === 'win32' && isBunExec(process.execPath)) {
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '""', '/B', process.execPath, entry, 'serve', ...serveArgs],
      { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: false },
    );
    child.unref();
    return { pid: child.pid };
  }
  const child = spawn(process.execPath, [entry, 'serve', ...serveArgs], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid };
}

function isBunExec(execPath: string): boolean {
  const lower = execPath.toLowerCase();
  return lower.endsWith('\\bun.exe') || lower.endsWith('/bun.exe') || lower.endsWith('bun');
}

async function fetchHealthPid(
  target: RestartTarget,
  path: string,
): Promise<number | undefined> {
  try {
    const res = await fetch(`http://${target.host}:${target.port}${path}`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { pid?: unknown };
    return typeof body.pid === 'number' ? body.pid : undefined;
  } catch {
    return undefined;
  }
}

async function bestEffortShutdown(target: RestartTarget, path: string): Promise<void> {
  try {
    await fetch(`http://${target.host}:${target.port}${path}`, { method: 'POST' });
  } catch {
    // server may close the socket mid-response, or already be down
  }
}

async function waitPortClosed(target: RestartTarget, deadlineMs: number): Promise<void> {
  const { createConnection } = await import('node:net');
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ host: target.host, port: target.port });
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => resolve(false));
    });
    if (!open) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitHealthyFreshPid(
  target: RestartTarget,
  path: string,
  deadlineMs: number,
  priorPid: number | undefined,
): Promise<{ ok: true; pid: number | undefined } | { ok: false; error: string }> {
  const deadline = Date.now() + deadlineMs;
  let lastSeenPid: number | undefined;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${target.host}:${target.port}${path}`);
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { pid?: unknown };
        const pid = typeof body.pid === 'number' ? body.pid : undefined;
        lastSeenPid = pid;
        // Stale-pid guard: if the same process that was running before the
        // shutdown is still answering, the shutdown didn't take and the
        // poll would silently false-positive. Keep polling.
        if (priorPid !== undefined && pid === priorPid) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        return { ok: true, pid };
      }
    } catch {
      // socket not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (lastSeenPid !== undefined && lastSeenPid === priorPid) {
    return {
      ok: false,
      error: `daemon shutdown did not take: pid ${priorPid} still answering /${path.replace(/^\//, '')}`,
    };
  }
  return { ok: false, error: 'daemon did not become healthy within timeout' };
}
