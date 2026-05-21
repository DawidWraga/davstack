// CLI-side client for talking to a running playwright-server. Used by the
// `playwright-server.ts` entry's `run` / `goto` / `refresh-auth` / `health` /
// `shutdown` verbs so agents don't need to remember curl URLs.
//
// Cold-start budget is the whole point of these verbs (must be quick to
// invoke from an agent loop), so this file imports nothing heavy — no
// @playwright/test, no bun:sqlite.

export type ClientOpts = {
  host: string;
  port: number;
};

export type RunResponse = {
  ok: boolean;
  durationMs?: number;
  setupMs?: number;
  file?: string;
  error?: string | { name: string; message: string; stack: string | null };
};

function baseUrl(opts: ClientOpts): string {
  return `http://${opts.host}:${opts.port}`;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: ClientOpts,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl(opts)}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { ok: res.ok, raw: text };
  }
  return parsed as T;
}

export async function runFile(file: string, opts: ClientOpts): Promise<RunResponse> {
  return request<RunResponse>('POST', '/run', opts, { file });
}

export async function gotoUrl(url: string, opts: ClientOpts): Promise<{ url: string }> {
  return request<{ url: string }>('POST', '/goto', opts, { url });
}

export async function refreshAuth(opts: ClientOpts): Promise<{
  ok: boolean;
  error?: string;
  origin?: string;
  keys?: string[];
}> {
  return request('POST', '/refresh-auth', opts);
}

export async function health(opts: ClientOpts): Promise<{
  ok: boolean;
  pid: number;
  url: string | null;
}> {
  return request('GET', '/health', opts);
}

// Best-effort: server may close the socket mid-response. Treat any network
// failure as success because the user's intent was "make it stop".
export async function shutdown(opts: ClientOpts): Promise<{ ok: true }> {
  try {
    await request('POST', '/shutdown', opts);
  } catch {
    // ignore
  }
  return { ok: true };
}
