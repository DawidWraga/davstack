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
import { dismissDialog, resetState } from './reset.js';
import { beginCapture, endCapture, ensureLoaderRegistered, runBucket } from './spec-runner.js';

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

export type RefreshModulesResult = {
  ok: boolean;
  refreshedAt: string;
  cacheRev: number;
  configReloaded: boolean;
  storageStateChanged: boolean;
  baseUrlChanged: boolean;
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
  // Bumped on every /refresh; appended to spec import URLs as
  // `?_pwsRev=<n>` so Node's ESM loader treats the spec — and every
  // transitive file:// import (see spec-loader.mjs) — as a fresh URL,
  // re-evaluating the module subgraph against any on-disk edits.
  private cacheRev = 1;
  private refreshedAtIso: string | null = null;

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

  get refreshedAt(): string | null {
    return this.refreshedAtIso;
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

  async runOnce(file: string, opts: { db?: string } = {}): Promise<RunResult> {
    this.assertLive();
    // Serialise; concurrent runs would interleave on the single warm page.
    const release = this.runLock;
    let releaseResolve!: () => void;
    this.runLock = new Promise<void>((r) => (releaseResolve = r));
    try {
      await release;
      const t0 = Date.now();
      const absFile = isAbsolute(file) ? file : resolve(this.cwd, file);

      // Multi-DB log routing. Seed window.__davstack_db before navigation
      // so the app's beforeSendLog reads it at init time. Two surfaces:
      //   - page.evaluate sets it immediately on the current document
      //   - context.addInitScript re-seeds on every subsequent navigation
      // No-op if the spec didn't request a routing DB.
      await this.applyDbRouting(opts.db);

      return await this.runOnceModule(absFile, file, t0);
    } finally {
      releaseResolve();
    }
  }

  private async applyDbRouting(db: string | undefined): Promise<void> {
    if (!this.context || !this.page) return;
    // Install a context-level init script every run; in steady-state usage
    // these accumulate (Playwright has no removeInitScript), but the cost
    // is a few hundred bytes per run and the LAST install wins on the
    // window. Acceptable for a long-lived daemon during a debug session.
    await this.context.addInitScript(
      (value: string | null) => {
        const w = window as Window & { __davstack_db?: string };
        if (value === null) {
          delete w.__davstack_db;
        } else {
          w.__davstack_db = value;
        }
      },
      db ?? null,
    );
    // Page.evaluate covers the case where the spec doesn't navigate (the
    // init script wouldn't fire). Tolerate failure — pages without a real
    // document can throw; the next navigation will re-seed via the script.
    try {
      await this.page.evaluate((value: string | null) => {
        const w = window as Window & { __davstack_db?: string };
        if (value === null) {
          delete w.__davstack_db;
        } else {
          w.__davstack_db = value;
        }
      }, db ?? null);
    } catch {
      // about:blank can't run scripts in some chromium builds — ignore
    }
  }

  // Install a loader hook that redirects @playwright/test imports to an
  // in-memory stub, dynamic-import the spec, then run each captured
  // test() block sequentially against the warm context.
  private async runOnceModule(
    absFile: string,
    displayFile: string,
    t0: number,
  ): Promise<RunResult> {
    try {
      ensureLoaderRegistered();
    } catch (e) {
      // Loader registration is one-shot per process; failures here are
      // permanent. Surface a clear error so the user can pin Node >=22.6.
      const err = e as Error;
      return {
        ok: false,
        durationMs: Date.now() - t0,
        file: displayFile,
        error: {
          name: 'LoaderInitError',
          message:
            `failed to register module loader for spec interception: ${err?.message ?? e}. ` +
            `Pin Node >= 22.6 (for --experimental-strip-types).`,
          stack: err?.stack ?? null,
        },
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

    const bucket = beginCapture(this.pw.expect);
    let loadError: Error | null = null;
    try {
      // Cache-bust so a re-run picks up edits. `_pwsRev` is bumped only by
      // /refresh; stable across consecutive runs so the spec's import
      // subgraph stays warm. The loader hook (spec-loader.mjs) propagates
      // this query down to every transitively-imported file:// module so
      // edits to UI models / fixtures pick up too — not just the spec.
      const url = `${pathToFileURL(absFile).href}?_pwsRev=${this.cacheRev}`;
      await import(url);
    } catch (e) {
      loadError = e as Error;
    }

    if (loadError) {
      endCapture();
      return {
        ok: false,
        durationMs: Date.now() - t0,
        setupMs,
        file: displayFile,
        error: {
          name: loadError.name ?? 'ImportError',
          message: String(loadError.message ?? loadError),
          stack: loadError.stack ?? null,
        },
      };
    }

    if (bucket.tests.length === 0) {
      endCapture();
      return {
        ok: false,
        durationMs: Date.now() - t0,
        setupMs,
        file: displayFile,
        error: {
          name: 'NoTests',
          message: 'spec file evaluated cleanly but registered zero test() blocks',
          stack: null,
        },
      };
    }

    let error: RunResult['error'] | undefined;
    try {
      let firstResetSkipped = false;
      const result = await runBucket(bucket, {
        fixtures: {
          page: this.page!,
          context: this.context!,
          browser: this.context!.browser?.() ?? null,
          request: this.context!.request,
        },
        resetBetween: async (current) => {
          // We already reset before runBucket, so the first test reuses
          // that page. Every subsequent test gets a fresh page.
          if (!firstResetSkipped) {
            firstResetSkipped = true;
            return current;
          }
          const fresh = await resetState({
            context: this.context!,
            page: current,
            authOrigin: this.authSeed?.origin ?? null,
            authKeys: this.authSeed?.entries.map((e) => e.name) ?? [],
          });
          this.page = fresh;
          return fresh;
        },
      });
      if (result.failed > 0) {
        const first = result.errors[0];
        error = {
          name: first.name,
          message:
            result.errors.length === 1
              ? `${first.test}: ${first.message}`
              : `${result.failed}/${result.ran} tests failed (first: ${first.test}: ${first.message})`,
          stack: first.stack,
        };
      }
    } catch (e) {
      const err = e as Error;
      error = {
        name: err?.name ?? 'Error',
        message: String(err?.message ?? e),
        stack: err?.stack ?? null,
      };
    } finally {
      endCapture();
    }

    return { ok: !error, durationMs: Date.now() - t0, setupMs, file: displayFile, error };
  }

  // ─── nav / lifecycle ─────────────────────────────────────────────────────

  async goto(url: string): Promise<{ url: string }> {
    this.assertLive();
    await this.page!.goto(url);
    return { url: this.page!.url() };
  }

  // In-place re-init without re-taking ownership of the daemon PID. The
  // motivating case: an agent edits a `*.ui.ts` helper that a spec imports;
  // without /refresh, the only way to evict the stale module from Node's
  // ESM cache is shutdown + serve, which silently steals the daemon out of
  // a TUI session (the user has to re-claim). /refresh bumps cacheRev so
  // the next spec import (and its transitive subgraph, via the loader
  // hook) re-evaluates, while the browser, context, page, and HTTP socket
  // stay alive.
  //
  // Also re-reads playwright-server.config.ts. baseUrl / storageStatePath
  // changes are surfaced as flags in the response but NOT auto-applied —
  // reseating the context to a different storage state mid-session is
  // risky (mid-flight runs, attached page event listeners, persistent
  // profile mismatch). Caller decides whether to follow up with a
  // shutdown+serve.
  async refresh(): Promise<RefreshModulesResult> {
    this.assertLive();
    // Serialise against in-flight runs — bumping cacheRev mid-import
    // would yield a half-cached module graph on the next run.
    const release = this.runLock;
    let releaseResolve!: () => void;
    this.runLock = new Promise<void>((r) => (releaseResolve = r));
    try {
      await release;
      const previousStorage = this.config.storageStatePath;
      const previousBase = this.config.baseUrl;
      let configReloaded = false;
      try {
        this.config = await loadConfig(this.cwd);
        configReloaded = true;
      } catch (e) {
        this.log(`refresh: config reload failed (${(e as Error)?.message ?? e}); keeping prior config`);
      }
      this.cacheRev += 1;
      const refreshedAt = new Date().toISOString();
      this.refreshedAtIso = refreshedAt;
      const storageStateChanged = configReloaded && this.config.storageStatePath !== previousStorage;
      const baseUrlChanged = configReloaded && this.config.baseUrl !== previousBase;
      if (storageStateChanged || baseUrlChanged) {
        this.log(
          `refresh: config drift detected (storageStatePath=${storageStateChanged}, baseUrl=${baseUrlChanged}); ` +
            `not reseating warm context — run shutdown + serve if you need the new value live`,
        );
      }
      this.log(`refresh: cacheRev=${this.cacheRev} refreshedAt=${refreshedAt}`);
      return {
        ok: true,
        refreshedAt,
        cacheRev: this.cacheRev,
        configReloaded,
        storageStateChanged,
        baseUrlChanged,
      };
    } finally {
      releaseResolve();
    }
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
