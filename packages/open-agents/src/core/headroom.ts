export type HeadroomMode = 'auto' | 'off' | 'require';

export interface HeadroomConfig {
  mode?: HeadroomMode;
  url?: string;
  logStats?: boolean;
}

export interface HeadroomState {
  active: boolean;
  required: boolean;
  url: string;
  openAIBaseUrl: string;
  env: Record<string, string>;
  reason?: string;
}

export interface HeadroomStats {
  requestsTotal: number;
  tokensSaved: number;
  inputTokens: number;
  outputTokens: number;
  raw: unknown;
}

export type HeadroomMessage = Record<string, unknown> & {
  role?: string;
  content?: unknown;
};

export interface HeadroomCompressionResult {
  messages: HeadroomMessage[];
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  transformsApplied: string[];
  raw: unknown;
}

interface HeadroomStatsResponse {
  requests?: {
    total?: number;
  };
  tokens?: {
    input?: number;
    output?: number;
    saved?: number;
  };
}

interface HeadroomCompressionResponse {
  messages?: HeadroomMessage[];
  tokens_before?: number;
  tokens_after?: number;
  tokens_saved?: number;
  compression_ratio?: number;
  transforms_applied?: string[];
  tokensBefore?: number;
  tokensAfter?: number;
  tokensSaved?: number;
  compressionRatio?: number;
  transformsApplied?: string[];
}

const DEFAULT_URL = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 750;

function cleanUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseMode(value: unknown): HeadroomMode | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  if (lower === 'auto' || lower === 'off' || lower === 'require') return lower;
  return undefined;
}

export function resolveHeadroomConfig(input?: {
  config?: HeadroomConfig;
  env?: NodeJS.ProcessEnv;
  modeFlag?: string;
  urlFlag?: string;
}): Required<Pick<HeadroomConfig, 'mode' | 'url' | 'logStats'>> {
  const env = input?.env ?? process.env;
  const mode =
    parseMode(input?.modeFlag) ??
    parseMode(env.OPEN_AGENTS_HEADROOM) ??
    input?.config?.mode ??
    'auto';
  const url = cleanUrl(
    input?.urlFlag || env.OPEN_AGENTS_HEADROOM_URL || input?.config?.url || DEFAULT_URL,
  );
  const logStats =
    env.OPEN_AGENTS_HEADROOM_LOG_STATS === '0' || env.OPEN_AGENTS_HEADROOM_LOG_STATS === 'false'
      ? false
      : (input?.config?.logStats ?? true);
  return { mode, url, logStats };
}

async function fetchJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function postJson(url: string, body: unknown, timeoutMs = 15_000): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function detectHeadroom(input: {
  adapterName: string;
  config: Required<Pick<HeadroomConfig, 'mode' | 'url' | 'logStats'>>;
}): Promise<HeadroomState> {
  const { adapterName, config } = input;
  const required = config.mode === 'require';
  const openAIBaseUrl = `${config.url}/v1`;
  if (config.mode === 'off') {
    return { active: false, required, url: config.url, openAIBaseUrl, env: {}, reason: 'disabled' };
  }
  if (adapterName !== 'cursor') {
    return {
      active: false,
      required,
      url: config.url,
      openAIBaseUrl,
      env: {},
      reason: `adapter ${adapterName} does not use the OpenAI-compatible proxy path`,
    };
  }
  try {
    await fetchJson(`${config.url}/health`);
    return {
      active: true,
      required,
      url: config.url,
      openAIBaseUrl,
      env: { OPENAI_BASE_URL: openAIBaseUrl },
    };
  } catch (err) {
    if (required) {
      throw new Error(
        `Headroom is required but not healthy at ${config.url}: ${(err as Error).message}`,
      );
    }
    return {
      active: false,
      required,
      url: config.url,
      openAIBaseUrl,
      env: {},
      reason: (err as Error).message,
    };
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function readHeadroomStats(url: string): Promise<HeadroomStats | null> {
  try {
    const raw = await fetchJson(`${cleanUrl(url)}/stats`);
    const stats = raw as HeadroomStatsResponse;
    return {
      requestsTotal: numberOrZero(stats.requests?.total),
      tokensSaved: numberOrZero(stats.tokens?.saved),
      inputTokens: numberOrZero(stats.tokens?.input),
      outputTokens: numberOrZero(stats.tokens?.output),
      raw,
    };
  } catch {
    return null;
  }
}

export async function compressHeadroomMessages(input: {
  url: string;
  messages: HeadroomMessage[];
  model?: string;
  tokenBudget?: number;
}): Promise<HeadroomCompressionResult> {
  const raw = await postJson(`${cleanUrl(input.url)}/v1/compress`, {
    model: input.model || 'gpt-4o',
    tokenBudget: input.tokenBudget,
    messages: input.messages,
  });
  const result = raw as HeadroomCompressionResponse;
  return {
    messages: Array.isArray(result.messages) ? result.messages : input.messages,
    tokensBefore: numberOrZero(result.tokens_before ?? result.tokensBefore),
    tokensAfter: numberOrZero(result.tokens_after ?? result.tokensAfter),
    tokensSaved: numberOrZero(result.tokens_saved ?? result.tokensSaved),
    compressionRatio: numberOrZero(result.compression_ratio ?? result.compressionRatio),
    transformsApplied: Array.isArray(result.transforms_applied ?? result.transformsApplied)
      ? ((result.transforms_applied ?? result.transformsApplied) as string[])
      : [],
    raw,
  };
}

export function formatHeadroomDelta(before: HeadroomStats | null, after: HeadroomStats | null): string | null {
  if (!before || !after) return null;
  const bits: string[] = [];
  const requestDelta = after.requestsTotal - before.requestsTotal;
  if (requestDelta > 0) bits.push(`${requestDelta} request${requestDelta === 1 ? '' : 's'}`);
  const savedDelta = after.tokensSaved - before.tokensSaved;
  if (savedDelta > 0) bits.push(`${Math.round(savedDelta).toLocaleString()} tokens saved`);
  return bits.length ? bits.join(', ') : null;
}
