// Shared daemon-restart helper used by playwright-server / vitest-server /
// logs-server `refresh --hard`. Sequences: client-side shutdown → wait for
// the listening socket to release → spawn a detached `<execPath> <entry>
// serve …` → poll the daemon's health endpoint until it answers.
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
  await bestEffortShutdown(target, opts.shutdownPath ?? '/shutdown');
  // Wait for the old socket to release before re-binding. SO_REUSEADDR
  // semantics differ across platforms; on Windows in particular, immediate
  // re-bind can fail with EADDRINUSE.
  await waitPortClosed(target, 5000);
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [opts.entry, 'serve', ...opts.serveArgs], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const healthOk = await waitHealthy(
    target,
    opts.healthPath ?? '/health',
    opts.startupTimeoutMs ?? 30_000,
  );
  if (!healthOk) {
    return {
      ok: false,
      pid: child.pid,
      startupMs: Date.now() - t0,
      error: 'daemon did not become healthy within timeout',
    };
  }
  return { ok: true, pid: child.pid, startupMs: Date.now() - t0 };
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

async function waitHealthy(
  target: RestartTarget,
  path: string,
  deadlineMs: number,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${target.host}:${target.port}${path}`);
      if (res.ok) return true;
    } catch {
      // socket not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
