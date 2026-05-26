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
// skill script's own dir. See playwright-server/session.ts for the rationale.
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
};

export class VitestSession {
  private vitest: VitestInstance | null = null;
  private capturedById = new Map<string, TestEntry>();
  private runLock: Promise<void> = Promise.resolve();
  private disposed = false;
  private vitestApi!: VitestApi;

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
