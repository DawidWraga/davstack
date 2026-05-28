// CLI-side client for talking to a running logs-server daemon. Used by
// the `refresh` / `health` verbs in index.ts. Cold-start cheap (pure
// fetch, no bun:sqlite import).
//
// Control-plane endpoints use the `/__` prefix to avoid colliding with
// envelope URLs (real Sentry SDK envelopes hit `/api/<id>/envelope/`,
// JS tunnel hits arbitrary relative paths — anything outside the
// `/__` namespace still falls through to envelope ingest).

export type ClientOpts = {
  host: string;
  port: number;
};

export type RefreshResponse = {
  ok: boolean;
  refreshedAt: string;
  closedHandles: number;
  configReloaded: boolean;
  error?: string;
};

export type HealthResponse = {
  ok: boolean;
  pid: number;
  refreshedAt: string | null;
};

function baseUrl(opts: ClientOpts): string {
  return `http://${opts.host}:${opts.port}`;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: ClientOpts,
): Promise<T> {
  const res = await fetch(`${baseUrl(opts)}${path}`, { method });
  const text = await res.text();
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return { ok: res.ok, raw: text } as unknown as T;
  }
}

export async function refresh(opts: ClientOpts): Promise<RefreshResponse> {
  return request<RefreshResponse>('POST', '/__refresh', opts);
}

export async function health(opts: ClientOpts): Promise<HealthResponse> {
  return request<HealthResponse>('GET', '/__health', opts);
}
