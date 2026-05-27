// Registration-intercept spec runner. Replaces source-extraction with a
// proper module evaluation that intercepts `@playwright/test`'s `test()`
// registrations so we can run the captured callbacks against our warm
// browser context.
//
// Design:
//   1. Install a module-loader hook that redirects `@playwright/test`
//      imports (from spec files) to an in-memory stub module. The stub
//      re-exports the real `expect` but replaces `test` with a capture
//      function. State is shared via globalThis so the loader (which
//      runs in a separate worker thread) and the main thread agree on
//      which spec is currently being collected.
//   2. Dynamic-import the spec file. Node 22.6+ strips TS natively; we
//      assume the consumer is on >= 22.6 (the package already declares
//      engines.node >= 20, so we tighten the doc but tolerate older Node
//      by surfacing a clear error if strip-types is unavailable).
//   3. Collect tests, beforeEach/afterEach hooks, and `test.use` config.
//   4. Run each test sequentially against the live page, applying hooks.
//
// Custom `test.extend` is NOT supported in this initial cut — if the spec
// calls `.extend({...})`, we throw a clear error pointing at the limitation.

import { register } from "node:module"
import { pathToFileURL } from "node:url"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { writeFileSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { randomBytes } from "node:crypto"
import type { BrowserContext, Page } from "@playwright/test"

// ─── shared state between loader hook & main thread ─────────────────────────
//
// The loader runs in a worker thread, so we can't share JS objects with the
// main thread directly. But the loader only needs to know ONE thing: the
// absolute path of our stub file. We hand it that via the register() data
// channel. The stub file then talks to the main thread by attaching the
// capture array to globalThis (which IS shared across the loader-hook worker
// and the main isolate's `--experimental-vm-modules`? — no it isn't).
//
// Resolution: the stub doesn't need worker access. It runs in the MAIN
// thread (it's the module that resolves `@playwright/test` for the spec
// file when the spec is dynamic-imported in the main thread). The loader
// hook only does PATH redirection. The capture state lives on globalThis
// in the main thread; the stub reads it from there.

type CapturedTest = {
  name: string
  fn: TestFn
  // Tag this test with which describe-chain it lived in, for nicer error
  // messages.
  describePath: string[]
}

type TestFn = (fixtures: PlaywrightFixtures) => Promise<void> | void

type PlaywrightFixtures = {
  page: Page
  context: BrowserContext
  browser: import("@playwright/test").Browser | null
  request: import("@playwright/test").APIRequestContext
}

type CaptureBucket = {
  tests: CapturedTest[]
  beforeEach: TestFn[]
  afterEach: TestFn[]
  beforeAll: TestFn[]
  afterAll: TestFn[]
  use: Record<string, unknown>
  describeStack: string[]
  extendUsed: boolean
}

declare global {
  // eslint-disable-next-line no-var
  var __davstackPwsCapture: CaptureBucket | undefined
  // eslint-disable-next-line no-var
  var __davstackPwsExpect: unknown
}

function freshBucket(): CaptureBucket {
  return {
    tests: [],
    beforeEach: [],
    afterEach: [],
    beforeAll: [],
    afterAll: [],
    use: {},
    describeStack: [],
    extendUsed: false,
  }
}

// ─── loader registration (one-shot per process) ─────────────────────────────

let registered = false
let stubPath: string | null = null

export function ensureLoaderRegistered(): { stubPath: string } {
  if (registered && stubPath) return { stubPath }

  // Materialise the stub module on disk. Putting it inside an installed
  // package's directory complicates resolution; a temp file with an
  // absolute path that the loader hook substitutes is the simplest path.
  const dir = resolve(tmpdir(), "davstack-pws-stub")
  mkdirSync(dir, { recursive: true })
  const id = randomBytes(4).toString("hex")
  const stub = resolve(dir, `playwright-stub-${id}.mjs`)
  writeFileSync(stub, STUB_SOURCE)
  stubPath = stub

  // The loader hook is in a separate file because register() loads it as a
  // standalone ESM module in a worker thread.
  const here = dirname(fileURLToPath(import.meta.url))
  const loaderUrl = pathToFileURL(resolve(here, "spec-loader.mjs")).href
  register(loaderUrl, {
    parentURL: pathToFileURL(`${here}/`).href,
    data: { stubUrl: pathToFileURL(stub).href },
  })
  registered = true
  return { stubPath: stub }
}

// ─── the stub module written to disk ────────────────────────────────────────
//
// This file is loaded by the spec instead of `@playwright/test`. It:
// - Re-exports the real `expect` (read from globalThis where the main
//   thread put it during boot — the loader-hook redirect happens in the
//   same Node main isolate when ESM resolution is hit, so globalThis IS
//   shared with the spec-loading code).
// - Replaces `test` with a capture function backed by globalThis state.
// - Stubs `.describe`, `.beforeEach`, `.afterEach`, `.beforeAll`,
//   `.afterAll`, `.use`, `.step`, `.skip`, `.only`, `.fixme`, `.fail`,
//   `.slow` — most either capture or no-op, none throw.
// - `.extend` flips an "unsupported" flag the runner checks before
//   executing, so the error surfaces with a real stack rather than
//   "test.extend is not a function".

const STUB_SOURCE = `// auto-generated by @davstack/playwright-server
const bucket = () => {
  if (!globalThis.__davstackPwsCapture) {
    throw new Error("playwright-server: capture bucket missing — ensureCaptureBucket() must run before spec import")
  }
  return globalThis.__davstackPwsCapture
}

function makeTest() {
  const t = (name, fn) => {
    const b = bucket()
    b.tests.push({ name: String(name), fn, describePath: [...b.describeStack] })
  }
  t.describe = (name, body) => {
    const b = bucket()
    b.describeStack.push(String(name))
    try { body() } finally { b.describeStack.pop() }
  }
  // Some specs use test.describe.configure({ mode: ... }) — no-op.
  t.describe.configure = () => {}
  t.describe.skip = (_name, _body) => {} // skip the whole block
  t.describe.only = (name, body) => t.describe(name, body)
  t.describe.parallel = (name, body) => t.describe(name, body)
  t.describe.serial = (name, body) => t.describe(name, body)
  t.beforeEach = (fn) => { bucket().beforeEach.push(fn) }
  t.afterEach = (fn) => { bucket().afterEach.push(fn) }
  t.beforeAll = (fn) => { bucket().beforeAll.push(fn) }
  t.afterAll = (fn) => { bucket().afterAll.push(fn) }
  t.use = (config) => { Object.assign(bucket().use, config || {}) }
  // step: run the body, return its result. We're already inside a real
  // test function so just invoke it.
  t.step = async (_name, body) => body()
  // skip / only / fixme / fail / slow as chained variants → still capture
  // (treat .only as a normal test; .skip skips).
  t.skip = (name, fn) => {
    if (typeof name === "function" || (typeof name === "string" && typeof fn === "function")) {
      // intentional skip — drop
      return
    }
    // skip() called inside a test body → noop here, test is already running
  }
  t.only = (name, fn) => t(name, fn)
  t.fixme = () => {}
  t.fail = (name, fn) => t(name, fn)
  t.slow = () => {}
  t.setTimeout = () => {}
  t.info = () => ({})
  // extend → unsupported. Return a shim that still LOOKS like test() so
  // the spec evaluates, but flips a flag the runner checks.
  t.extend = (_fixtures) => {
    bucket().extendUsed = true
    return makeTest()
  }
  return t
}

export const test = makeTest()
export const expect = globalThis.__davstackPwsExpect
export default { test, expect }
`

// ─── capture-bucket lifecycle ───────────────────────────────────────────────

export function beginCapture(expectFn: unknown): CaptureBucket {
  const bucket = freshBucket()
  globalThis.__davstackPwsCapture = bucket
  globalThis.__davstackPwsExpect = expectFn
  return bucket
}

export function endCapture(): void {
  globalThis.__davstackPwsCapture = undefined
  globalThis.__davstackPwsExpect = undefined
}

// ─── run a captured bucket against live fixtures ────────────────────────────

export type RunBucketArgs = {
  fixtures: PlaywrightFixtures
  resetBetween: (current: Page) => Promise<Page>
}

export type RunBucketResult = {
  ran: number
  passed: number
  failed: number
  errors: Array<{ test: string; name: string; message: string; stack: string | null }>
}

export async function runBucket(
  bucket: CaptureBucket,
  args: RunBucketArgs,
): Promise<RunBucketResult> {
  if (bucket.extendUsed) {
    throw new Error(
      "playwright-server: this spec uses `test.extend(...)` for custom fixtures, which is " +
        "not yet supported by the warm-browser runner. Workarounds: (a) move shared setup " +
        "into `test.beforeEach`, or (b) use module-level helper functions. Custom-fixture " +
        "support is planned — track @davstack/playwright-server changelog.",
    )
  }

  const result: RunBucketResult = { ran: 0, passed: 0, failed: 0, errors: [] }
  let currentPage = args.fixtures.page

  // beforeAll once, before any test.
  for (const fn of bucket.beforeAll) {
    await fn({ ...args.fixtures, page: currentPage })
  }

  for (const t of bucket.tests) {
    result.ran++
    try {
      currentPage = await args.resetBetween(currentPage)
      const fixtures = { ...args.fixtures, page: currentPage }
      for (const fn of bucket.beforeEach) await fn(fixtures)
      await t.fn(fixtures)
      for (const fn of bucket.afterEach) await fn(fixtures)
      result.passed++
    } catch (e) {
      result.failed++
      const err = e as Error
      result.errors.push({
        test: [...t.describePath, t.name].join(" › "),
        name: err?.name ?? "Error",
        message: String(err?.message ?? e),
        stack: err?.stack ?? null,
      })
    }
  }

  for (const fn of bucket.afterAll) {
    try {
      await fn({ ...args.fixtures, page: currentPage })
    } catch {
      // swallow afterAll errors so they don't mask test results
    }
  }

  return result
}
