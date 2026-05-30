// VitestSession owns the long-lived Vitest instance. Static factory boots
// once (vite + playwright + storybook addon, ~50s cold) and instance
// methods rerun specific files against the warm pool (~3-15s).
//
// Runtime: recommended `node --experimental-transform-types ./index.ts
// serve` (Node 24+). Works under Bun on Linux/macOS but not Windows —
// bun + Storybook 10.3 produces malformed `file:/C:/…` URLs inside the
// vitest preset loader, and the playwright-browser-mode worker then
// times out the connect. tsx also fails (its tsconfig-paths resolver
// misfires on `@vitest/mocker/node_modules/estree-walker` →
// ERR_PACKAGE_PATH_NOT_EXPORTED). Everything in this folder uses pure
// Node APIs (node:http, no Bun.serve), so the swap is source-free.
//
// Implementation notes (load-bearing — each was empirically discovered;
// silent failures abound if you skip one):
//
// 1. Use `startVitest` (CLI entry), not `createVitest` + manual init. The
//    latter triggers a different Vite optimize path that fails to resolve
//    playwright-core's chromium-bidi deps.
// 2. Pass a REAL story file as the boot cliFilter, not [] or a noop pattern.
//    The storybook plugin only fully wires up its per-story `transform`
//    hook after seeing one valid file through the CLI path; a no-op leaves
//    the plugin half-initialised and subsequent reruns yield "(0 test)".
// 3. To rerun a different file later:
//      a) clear vitest.filenamePattern (the boot cli filter persists and
//         silently drops non-matching files)
//      b) call vitest.invalidateFile(absFile) so Vite doesn't serve the
//         cached untransformed module
//      c) populate vitest.watcher.changedTests yourself — scheduleRerun
//         reads from it; its `triggerId` arg is only the log label
//      d) the path in changedTests must use forward slashes on Windows —
//         vitest's testFilesList comes from tinyglobby (forward slashes),
//         and `_isCachedTestFile` uses literal `.includes()`
//      e) await scheduleRerun (which only sets a debounce timer), then
//         poll vitest.runningPromise until it's set, then await it.
//         Reporter hooks like `onFinished` are unreliable for programmatic
//         reporters in watch mode.

import { resolve, isAbsolute, relative, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CONFIG, loadConfig, type ResolvedConfig } from './config.js';

// First story file under cwd — used when consumer didn't set primeFile.
// Skips node_modules + dotfiles. Returns a forward-slash cwd-relative path.
async function findFirstStoryFile(cwd: string): Promise<string | null> {
  const stories = /\.stories\.(tsx|jsx|ts|js|mdx)$/;
  const skip = new Set(['node_modules', 'dist', 'build', '.git']);
  const stack: string[] = [cwd];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && stories.test(e.name)) {
        return relative(cwd, full).replace(/\\/g, '/');
      }
    }
  }
  return null;
}

// Peer-dep load: resolve vitest/node from the consumer's cwd, not from the
// skill script's own dir. This ensures the consumer's installed version of
// vitest is used rather than any version the daemon itself might carry.
type VitestApi = {
  startVitest: typeof import('vitest/node').startVitest;
};

async function loadVitest(cwd: string): Promise<VitestApi> {
  const req = createRequire(`${cwd}/__diagnose_resolve_anchor__`);
  let resolved: string;
  try {
    resolved = req.resolve('vitest/node');
  } catch (e) {
    throw new Error(
      `vitest-server: could not resolve 'vitest/node' from ${cwd}. ` +
        `Install vitest in the consumer project (npm i -D vitest) or boot with ` +
        `--cwd pointed at a dir whose node_modules contains it. Original: ${(e as Error)?.message ?? e}`,
    );
  }
  // pathToFileURL: Node's ESM loader rejects raw 'C:\...' paths on Windows.
  // default-unwrap: handles CJS-via-ESM under Node; falls through under bun.
  const mod = (await import(pathToFileURL(resolved).href)) as
    | VitestApi
    | { default: VitestApi };
  return ('default' in mod ? mod.default : mod) as VitestApi;
}
import {
  buildTestEntry,
  formatError,
  isStorybookWrapper,
  walkTaskTreeForTests,
  type TestEntry,
} from './format.js';

export type RunOpts = {
  file: string;
  testNamePattern?: string;
};

export type RunResult = {
  ok: boolean;
  durationMs: number;
  file: string;
  summary: { total: number; passed: number; failed: number; skipped: number };
  tests: TestEntry[];
  errors: unknown[];
};

type Logger = (...args: unknown[]) => void;

export type CreateOpts = {
  cwd: string;
  project?: string;
  primeFile?: string;
  log?: Logger;
};

// Vitest's public-but-not-typed surface that we touch.
type ViteModuleGraph = {
  invalidateAll?: () => void;
  urlToModuleMap?: Map<string, unknown>;
  fileToModulesMap?: Map<string, Set<unknown>>;
};
type ViteServer = {
  moduleGraph?: ViteModuleGraph;
  environments?: Record<string, { moduleGraph?: ViteModuleGraph }>;
};
type ViteNode = {
  moduleCache?: { clear: () => void };
};
type VitestInstance = {
  state: {
    clearErrors: () => void;
    getFiles: () => any[];
    getUnhandledErrors?: () => unknown[];
    idMap?: Map<string, any>;
  };
  watcher?: { changedTests?: Set<string> };
  runningPromise?: Promise<unknown>;
  filenamePattern?: string;
  invalidateFile?: (abs: string) => void;
  scheduleRerun: (id: string) => Promise<void>;
  setGlobalTestNamePattern: (p: string) => void;
  resetGlobalTestNamePattern: () => void;
  close: () => Promise<void>;
  server?: ViteServer;
  vite?: ViteServer;
  vitenode?: ViteNode;
  projects?: Array<{ server?: ViteServer; vite?: ViteServer; vitenode?: ViteNode }>;
};

export type RefreshResult = {
  ok: boolean;
  refreshedAt: string;
  cacheRev: number;
  invalidatedFiles: number;
  moduleGraphCleared: boolean;
  configReloaded: boolean;
};

export class VitestSession {
  private vitest: VitestInstance | null = null;
  private capturedById = new Map<string, TestEntry>();
  private runLock: Promise<void> = Promise.resolve();
  private disposed = false;
  private vitestApi!: VitestApi;
  private cacheRev = 1;
  private refreshedAtIso: string | null = null;

  private constructor(
    private readonly cwd: string,
    private readonly config: ResolvedConfig,
    private readonly log: Logger,
  ) {}

  static async create(opts: CreateOpts): Promise<VitestSession> {
    const log = opts.log ?? ((...a) => console.log('[vitest-server]', ...a));
    const cwd = resolve(opts.cwd);
    const fileConfig = await loadConfig(cwd);
    const config: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      ...fileConfig,
      ...(opts.project ? { project: opts.project } : {}),
      ...(opts.primeFile ? { primeFile: opts.primeFile } : {}),
    };
    if (!config.primeFile) {
      const discovered = await findFirstStoryFile(cwd);
      if (!discovered) {
        throw new Error(
          'vitest-server: no *.stories.{tsx,jsx,ts,js,mdx} found under cwd. ' +
            'Set primeFile in vitest-server.config.ts or pass --prime <file>. ' +
            'The storybook addon needs a real file to wire its per-story ' +
            'transform hook on boot.',
        );
      }
      log(`primeFile not set; auto-discovered ${discovered}`);
      config.primeFile = discovered;
    }
    const session = new VitestSession(cwd, config, log);
    session.vitestApi = await loadVitest(cwd);
    await session.boot();
    return session;
  }

  private async boot(): Promise<void> {
    const t0 = Date.now();
    this.log(`booting vitest (project=${this.config.project})…`);
    const reporter = {
      // Backup result channel: per-task updates streamed from workers.
      // state.getFiles() is the primary channel; this catches edge cases
      // where a task result appears in the stream but not the final tree.
      onTaskUpdate: (packs: any[]) => {
        if (!Array.isArray(packs)) return;
        for (const pack of packs) {
          const [id, result] = pack;
          if (!result) continue;
          const task = this.vitest?.state.idMap?.get?.(id);
          if (!task || task.type !== 'test') continue;
          if (result.state !== 'pass' && result.state !== 'fail' && result.state !== 'skip')
            continue;
          this.capturedById.set(id, buildTestEntry(task, result));
        }
      },
    };
    this.vitest = (await this.vitestApi.startVitest(
      'test',
      [this.config.primeFile],
      {
        watch: true,
        project: [this.config.project],
        root: this.cwd,
        passWithNoTests: true,
      },
      {},
      { reporters: [reporter] },
    )) as unknown as VitestInstance;
    this.log(`booted + primed in ${Date.now() - t0}ms (primed with ${this.config.primeFile})`);
  }

  async runOnce(opts: RunOpts): Promise<RunResult> {
    this.assertLive();
    const release = this.runLock;
    let releaseResolve!: () => void;
    this.runLock = new Promise<void>((r) => (releaseResolve = r));
    try {
      await release;
      const t0 = Date.now();
      const v = this.vitest!;
      v.state.clearErrors();
      this.capturedById = new Map();

      if (opts.testNamePattern) v.setGlobalTestNamePattern(opts.testNamePattern);
      else v.resetGlobalTestNamePattern();

      // Forward slashes on Windows: vitest's testFilesList comes from
      // tinyglobby; `_isCachedTestFile` does literal `.includes()`, so a
      // backslash path silently misses → "No test files found".
      const absFile = (isAbsolute(opts.file) ? opts.file : resolve(this.cwd, opts.file)).replace(
        /\\/g,
        '/',
      );

      v.filenamePattern = '';
      if (typeof v.invalidateFile === 'function') v.invalidateFile(absFile);
      v.watcher?.changedTests?.add(absFile);
      await v.scheduleRerun(absFile);

      const pollStart = Date.now();
      while (!v.runningPromise && Date.now() - pollStart < 5000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      if (v.runningPromise) await v.runningPromise;

      for (const f of v.state.getFiles()) {
        const fp = (f.filepath as string | undefined)?.replace(/\\/g, '/');
        if (fp === absFile || f.name === absFile) walkTaskTreeForTests(f, this.capturedById);
      }

      // Run-level errors: vitest crashes, setup-file throws, unhandled
      // rejections. These don't attach to any one test; vitest tracks them
      // on state and (browser mode) on each File task's `result.errors`.
      const runErrors: unknown[] = [];
      for (const e of v.state.getUnhandledErrors?.() ?? []) {
        runErrors.push(formatError(e));
      }
      for (const f of v.state.getFiles()) {
        const fp = (f.filepath as string | undefined)?.replace(/\\/g, '/');
        if (fp !== absFile && f.name !== absFile) continue;
        for (const e of f.result?.errors ?? []) {
          if (!isStorybookWrapper(e)) runErrors.push(formatError(e));
        }
      }

      const tests = [...this.capturedById.values()];
      const durationMs = Date.now() - t0;
      const failed = tests.some((t) => t.state === 'failed') || runErrors.length > 0;
      return {
        ok: !failed,
        durationMs,
        file: opts.file,
        summary: {
          total: tests.length,
          passed: tests.filter((t) => t.state === 'passed').length,
          failed: tests.filter((t) => t.state === 'failed').length,
          skipped: tests.filter((t) => t.state === 'skipped').length,
        },
        tests,
        errors: runErrors,
      };
    } finally {
      releaseResolve();
    }
  }

  get refreshedAt(): string | null {
    return this.refreshedAtIso;
  }

  // In-place re-init that flushes Vite's module graph + vite-node's
  // module cache without restarting the vitest watcher. The motivating
  // case: an agent edits a non-test source file the daemon's transform
  // cache already evaluated; vitest's HMR watcher SHOULD pick it up but
  // empirically misses changes for files outside the watched glob (e.g.
  // a fixture imported by a story but located in a sibling package).
  // /refresh is the explicit signal "everything is stale, re-read from
  // disk on the next run."
  //
  // Re-reads vitest-server.config.ts but does NOT re-apply it — the
  // vitest instance was booted with the prior config and project filter
  // baked in. Surfaced as a flag so the caller can decide whether to
  // follow up with shutdown + serve.
  async refresh(): Promise<RefreshResult> {
    this.assertLive();
    const release = this.runLock;
    let releaseResolve!: () => void;
    this.runLock = new Promise<void>((r) => (releaseResolve = r));
    try {
      await release;
      let configReloaded = false;
      try {
        await loadConfig(this.cwd);
        configReloaded = true;
      } catch (e) {
        this.log(`refresh: config reload failed (${(e as Error)?.message ?? e}); ignoring`);
      }
      const { invalidatedFiles, moduleGraphCleared } = this.invalidateModuleGraph();
      this.cacheRev += 1;
      const refreshedAt = new Date().toISOString();
      this.refreshedAtIso = refreshedAt;
      this.log(
        `refresh: cacheRev=${this.cacheRev} invalidatedFiles=${invalidatedFiles} ` +
          `moduleGraphCleared=${moduleGraphCleared} refreshedAt=${refreshedAt}`,
      );
      return {
        ok: true,
        refreshedAt,
        cacheRev: this.cacheRev,
        invalidatedFiles,
        moduleGraphCleared,
        configReloaded,
      };
    } finally {
      releaseResolve();
    }
  }

  // Walk every plausible Vite/vite-node cache surface and invalidate it.
  // Vitest 1.x / 2.x / 3.x / 4.x reshuffle which property holds the
  // moduleGraph (server.moduleGraph vs server.environments.ssr.moduleGraph
  // vs vite.environments.client.moduleGraph). Rather than version-detect,
  // try every shape and count what actually fired. Tolerate missing
  // properties — a partial clear still helps and is better than
  // throwing.
  private invalidateModuleGraph(): { invalidatedFiles: number; moduleGraphCleared: boolean } {
    let invalidatedFiles = 0;
    let moduleGraphCleared = false;
    const v = this.vitest!;
    const invalidate = (abs: string) => {
      if (typeof v.invalidateFile !== 'function') return;
      try {
        v.invalidateFile(abs);
        invalidatedFiles++;
      } catch {
        // ignore — some Vitest versions throw on unknown ids
      }
    };
    // Every file currently in the test-file id map.
    for (const [_id, task] of v.state.idMap ?? new Map()) {
      const fp = (task?.filepath as string | undefined) ?? undefined;
      if (fp) invalidate(fp);
    }
    const candidates: Array<ViteServer | undefined> = [
      v.server,
      v.vite,
      ...(v.projects?.flatMap((p) => [p.server, p.vite]) ?? []),
    ];
    for (const c of candidates) {
      if (!c) continue;
      const graphs: Array<ViteModuleGraph | undefined> = [
        c.moduleGraph,
        ...Object.values(c.environments ?? {}).map((env) => env.moduleGraph),
      ];
      for (const g of graphs) {
        if (!g) continue;
        try {
          if (typeof g.invalidateAll === 'function') {
            g.invalidateAll();
            moduleGraphCleared = true;
          }
        } catch {
          // ignore
        }
      }
    }
    const nodeCaches: Array<ViteNode | undefined> = [
      v.vitenode,
      ...(v.projects?.map((p) => p.vitenode) ?? []),
    ];
    for (const n of nodeCaches) {
      if (!n?.moduleCache) continue;
      try {
        n.moduleCache.clear();
        moduleGraphCleared = true;
      } catch {
        // ignore
      }
    }
    return { invalidatedFiles, moduleGraphCleared };
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.vitest?.close();
    } catch {
      // ignore
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('VitestSession is disposed');
    if (!this.vitest) throw new Error('VitestSession not booted');
  }
}
