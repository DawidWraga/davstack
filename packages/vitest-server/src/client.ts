// CLI-side client for talking to a running vitest-server. Used by the
// `run` / `health` / `shutdown` verbs in index.ts. Cold-start cheap (no
// vitest import).

export type ClientOpts = {
  host: string;
  port: number;
};

export type RunResponse = {
  ok: boolean;
  durationMs?: number;
  file?: string;
  summary?: { total: number; passed: number; failed: number; skipped: number };
  tests?: unknown[];
  errors?: unknown[];
  error?: string;
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
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return { ok: res.ok, raw: text } as unknown as T;
  }
}

export async function runFile(
  file: string,
  opts: ClientOpts,
  extra: { testNamePattern?: string } = {},
): Promise<RunResponse> {
  const body: Record<string, unknown> = { file };
  if (extra.testNamePattern) body.testNamePattern = extra.testNamePattern;
  return request<RunResponse>('POST', '/run', opts, body);
}

export async function health(
  opts: ClientOpts,
): Promise<{ ok: boolean; pid: number; refreshedAt?: string | null }> {
  return request('GET', '/health', opts);
}

export type RefreshResponse = {
  ok: boolean;
  refreshedAt: string;
  cacheRev: number;
  invalidatedFiles: number;
  moduleGraphCleared: boolean;
  configReloaded: boolean;
};

export async function refresh(opts: ClientOpts): Promise<RefreshResponse> {
  return request<RefreshResponse>('POST', '/refresh', opts);
}

// Best-effort: server may close the socket mid-response.
export async function shutdown(opts: ClientOpts): Promise<{ ok: true }> {
  try {
    await request('POST', '/shutdown', opts);
  } catch {
    // ignore
  }
  return { ok: true };
}
