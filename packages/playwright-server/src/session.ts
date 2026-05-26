// PlaywrightSession owns the long-lived browser+context+page. Static factory
// boots everything up (config load → optional auth refresh → seed read →
// chromium launch → context+page wiring). Instance methods mutate the same
// page across runs so URL / auth / heap survive.
//
// Construction is via the static factory because boot is async and we want
// the post-create instance to be fully ready (no half-initialised state
// reachable). All public methods may assume the browser is live; they
// throw if called after shutdown.

import { resolve, isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  DEFAULT_CONFIG,
  loadConfig,
  readAuthSeed,
  writeStorageState,
  type AuthSeed,
  type ResolvedConfig,
} from './auth.js';
import { extractTestBody } from './extract.js';
import { dismissDialog, resetState } from './reset.js';

// Peer-dep load: resolve @playwright/test from the consumer's cwd, not from
// the skill script's own dir (which has no node_modules; bun would fall back
// to its global cache and pick up a version mismatched with the consumer's
// installed browsers). The anchor file doesn't need to exist — createRequire
// only uses it to seed the node_modules walk-up from the consumer dir.
type PlaywrightApi = {
  chromium: typeof import('@playwright/test').chromium;
  expect: typeof import('@playwright/test').expect;
};

async function loadPlaywright(cwd: string): Promise<PlaywrightApi> {
  const req = createRequire(`${cwd}/__diagnose_resolve_anchor__`);
  let resolved: string;
  try {
    resolved = req.resolve('@playwright/test');
  } catch (e) {
    throw new Error(
      `playwright-server: could not resolve '@playwright/test' from ${cwd}. ` +
        `Install it in the consumer project (npm i -D @playwright/test) or boot with ` +
        `--cwd pointed at a dir whose node_modules contains it. Original: ${(e as Error)?.message ?? e}`,
    );
  }
  // pathToFileURL: Node's ESM loader rejects raw 'C:\...' paths; bun is
  // tolerant but Node insists on file:// URLs on Windows. Harmless on POSIX.
  // default-unwrap: @playwright/test is CJS, so ESM import wraps named
  // exports under default. mod.default falls through to mod under bun.
  const mod = (await import(pathToFileURL(resolved).href)) as
    | PlaywrightApi
    | { default: PlaywrightApi };
  return ('default' in mod ? mod.default : mod) as PlaywrightApi;
}

export type RunResult = {
  ok: boolean;
  durationMs: number;
  setupMs?: number;
  file: string;
  error?: { name: string; message: string; stack: string | null };
};

export type RefreshResult = {
  ok: boolean;
  error?: string;
  origin?: string;
  keys?: string[];
};

type Logger = (...args: unknown[]) => void;

export type CreateOpts = {
  cwd: string;
  log?: Logger;
};

export class PlaywrightSession {
  private config: ResolvedConfig = DEFAULT_CONFIG;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private authSeed: AuthSeed | null = null;
  private runLock: Promise<void> = Promise.resolve();
  private disposed = false;
  private pw!: PlaywrightApi;

  private constructor(
    private readonly cwd: string,
    private readonly log: Logger,
  ) {}

  static async create(opts: CreateOpts): Promise<PlaywrightSession> {
    const log = opts.log ?? ((...a) => console.log('[playwright-server]', ...a));
    const session = new PlaywrightSession(resolve(opts.cwd), log);
    session.pw = await loadPlaywright(session.cwd);
    await session.boot();
    return session;
  }

  get pageUrl(): string | null {
    return this.page?.url() ?? null;
  }

  // ─── boot ────────────────────────────────────────────────────────────────

  private async boot(): Promise<void> {
    const t0 = Date.now();
    this.config = await loadConfig(this.cwd);
    await this.refreshAuthState();
    const hasSeed = this.loadSeed();

    this.browser = await this.pw.chromium.launch({ headless: false, args: ['--start-maximized'] });
    this.browser.on('disconnected', () => {
      // Skip exit if we're tearing down ourselves — the disconnect event
      // fires after our own browser.close() in shutdown(), and exiting 1
      // from there masks a clean /shutdown as a daemon crash.
      if (this.disposed) return;
      this.log('browser disconnected; exiting');
      process.exit(1);
    });

    if (hasSeed && this.authSeed) {
      this.context = await this.browser.newContext({
        storageState: resolve(this.cwd, this.config.storageStatePath),
        viewport: null,
        baseURL: this.config.baseUrl,
      });
      await this.installAuthInitScript();
    } else {
      this.log(`no storage seed; falling back to persistent profile at ${this.config.profilePath}`);
      this.context = await this.pw.chromium.launchPersistentContext(
        resolve(this.cwd, this.config.profilePath),
        {
          headless: false,
          viewport: null,
          baseURL: this.config.baseUrl,
          args: ['--start-maximized'],
        },
      );
    }

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.context.on('page', (p) => p.on('dialog', dismissDialog));
    this.page.on('dialog', dismissDialog);
    this.log(`booted in ${Date.now() - t0}ms`);
  }

  // localStorage seed installed as a context-level init script (runs on
  // every navigation) plus an explicit per-run replay. Belt-and-braces vs
  // the app's auth-provider stripping state on superseded JWTs.
  private async installAuthInitScript(): Promise<void> {
    if (!this.context || !this.authSeed) return;
    await this.context.addInitScript(
      (arg: { originUrl: string; entries: { name: string; value: string }[] }) => {
        try {
          if (window.location.origin !== arg.originUrl) return;
          for (const { name, value } of arg.entries) {
            window.localStorage.setItem(name, value);
          }
        } catch {
          // ignore privacy-mode / cross-origin
        }
      },
      { originUrl: this.authSeed.origin, entries: this.authSeed.entries },
    );
  }

  // ─── auth ────────────────────────────────────────────────────────────────

  private async refreshAuthState(): Promise<boolean> {
    if (!this.config.refreshAuth) {
      this.log('no refreshAuth in config — using existing storageStatePath as-is');
      return false;
    }
    try {
      const state = await this.config.refreshAuth();
      if (!state) {
        this.log('refreshAuth returned null — login likely failed');
        return false;
      }
      const path = resolve(this.cwd, this.config.storageStatePath);
      writeStorageState(path, state);
      this.log(`refreshed auth → ${path}`);
      return true;
    } catch (e) {
      this.log(`refreshAuth error: ${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  private loadSeed(): boolean {
    const seed = readAuthSeed(resolve(this.cwd, this.config.storageStatePath));
    if (!seed) return false;
    this.authSeed = seed;
    return true;
  }

  async refreshAuth(): Promise<RefreshResult> {
    this.assertLive();
    const ok = await this.refreshAuthState();
    if (!ok) return { ok: false, error: 'refreshAuthState failed; check config + .env' };
    if (!this.loadSeed() || !this.authSeed)
      return { ok: false, error: 'loadSeed failed after refresh' };
    await this.installAuthInitScript();
    if (this.authSeed.origin && this.page!.url().startsWith(this.authSeed.origin)) {
      await this.page!.evaluate((entries: { name: string; value: string }[]) => {
        for (const { name, value } of entries) {
          window.localStorage.setItem(name, value);
        }
      }, this.authSeed.entries).catch(() => {});
    }
    return {
      ok: true,
      origin: this.authSeed.origin,
      keys: this.authSeed.entries.map((e) => e.name),
    };
  }

  // ─── run ─────────────────────────────────────────────────────────────────

  async runOnce(file: string): Promise<RunResult> {
    this.assertLive();
    // Serialise; concurrent runs would interleave on the single warm page.
    const release = this.runLock;
    let releaseResolve!: () => void;
    this.runLock = new Promise<void>((r) => (releaseResolve = r));
    try {
      await release;
      const t0 = Date.now();
      const absFile = isAbsolute(file) ? file : resolve(this.cwd, file);
      const source = await readFile(absFile, 'utf8');
      const extracted = extractTestBody(source);
      if (!extracted) {
        return {
          ok: false,
          durationMs: Date.now() - t0,
          file,
          error: { name: 'ParseError', message: 'no test() block found', stack: null },
        };
      }
      const tSetup0 = Date.now();
      this.page = await resetState({
        context: this.context!,
        page: this.page!,
        authOrigin: this.authSeed?.origin ?? null,
        authKeys: this.authSeed?.entries.map((e) => e.name) ?? [],
      });
      const setupMs = Date.now() - tSetup0;

      const fixtureMap: Record<string, unknown> = {
        page: this.page,
        context: this.context,
        browser: this.context!.browser?.() ?? null,
        request: this.context!.request,
      };
      const args = extracted.fixtures;
      const AsyncFn = Object.getPrototypeOf(async function () {})
        .constructor as new (...names: string[]) => (...callArgs: unknown[]) => Promise<unknown>;
      const fn = new AsyncFn(...args, 'expect', extracted.body);
      const callArgs = args.map((a) => fixtureMap[a]);

      let error: RunResult['error'] | undefined;
      try {
        await fn(...callArgs, this.pw.expect);
      } catch (e) {
        const err = e as Error;
        error = {
          name: err?.name ?? 'Error',
          message: String(err?.message ?? e),
          stack: err?.stack ?? null,
        };
      }
      return { ok: !error, durationMs: Date.now() - t0, setupMs, file, error };
    } finally {
      releaseResolve();
    }
  }

  // ─── nav / lifecycle ─────────────────────────────────────────────────────

  async goto(url: string): Promise<{ url: string }> {
    this.assertLive();
    await this.page!.goto(url);
    return { url: this.page!.url() };
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.context?.close();
    } catch {
      // ignore — happens if profile context was used and browser already gone
    }
    try {
      await this.browser?.close();
    } catch {
      // ignore
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('PlaywrightSession is disposed');
    if (!this.context || !this.page) throw new Error('PlaywrightSession not booted');
  }
}
