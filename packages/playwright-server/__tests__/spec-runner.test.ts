// Tests for the registration-interception spec runner. The full
// loader-hook → @playwright/test redirection path needs a real spec file
// and real Node module.register, so we cover that via the bundled
// fixture under fixtures/. The capture bucket + run logic is exercised
// here with hand-built buckets so we can assert per-hook ordering and
// the extend-unsupported error without booting chromium.

import { test, expect } from 'vitest'
import type { Page, BrowserContext, APIRequestContext, Browser } from '@playwright/test'
import { runBucket } from '../src/spec-runner.js'

// Build a minimal-shape Page mock. We only need identity comparison for
// reset-between, and a `url()` so the test doesn't blow up if something
// touches it.
function fakePage(label = 'p'): Page {
  return {
    __label: label,
    url: () => 'about:blank',
  } as unknown as Page
}

function fakeFixtures(page: Page) {
  return {
    page,
    context: {} as BrowserContext,
    browser: null as Browser | null,
    request: {} as APIRequestContext,
  }
}

test('runs a single captured test', async () => {
  let called = false
  const bucket = {
    tests: [{ name: 't1', fn: async () => { called = true }, describePath: [] }],
    beforeEach: [],
    afterEach: [],
    beforeAll: [],
    afterAll: [],
    use: {},
    describeStack: [],
    extendUsed: false,
  }
  const page = fakePage()
  const result = await runBucket(bucket, {
    fixtures: fakeFixtures(page),
    resetBetween: async (p) => p,
  })
  expect(called).toBe(true)
  expect(result).toEqual({ ran: 1, passed: 1, failed: 0, errors: [] })
})

test('runs multiple tests sequentially and resets between them', async () => {
  const order: string[] = []
  const bucket = {
    tests: [
      { name: 'a', fn: async () => { order.push('a') }, describePath: [] },
      { name: 'b', fn: async () => { order.push('b') }, describePath: [] },
      { name: 'c', fn: async () => { order.push('c') }, describePath: [] },
    ],
    beforeEach: [],
    afterEach: [],
    beforeAll: [],
    afterAll: [],
    use: {},
    describeStack: [],
    extendUsed: false,
  }
  let resets = 0
  const result = await runBucket(bucket, {
    fixtures: fakeFixtures(fakePage()),
    resetBetween: async (p) => { resets++; return p },
  })
  expect(order).toEqual(['a', 'b', 'c'])
  expect(resets).toBe(3) // one per test (including the first call)
  expect(result.passed).toBe(3)
})

test('runs beforeEach / afterEach around each test', async () => {
  const events: string[] = []
  const bucket = {
    tests: [
      { name: 'one', fn: async () => { events.push('t1') }, describePath: [] },
      { name: 'two', fn: async () => { events.push('t2') }, describePath: [] },
    ],
    beforeEach: [async () => { events.push('before') }],
    afterEach: [async () => { events.push('after') }],
    beforeAll: [],
    afterAll: [],
    use: {},
    describeStack: [],
    extendUsed: false,
  }
  await runBucket(bucket, {
    fixtures: fakeFixtures(fakePage()),
    resetBetween: async (p) => p,
  })
  expect(events).toEqual(['before', 't1', 'after', 'before', 't2', 'after'])
})

test('runs beforeAll once before any test, afterAll once at the end', async () => {
  const events: string[] = []
  const bucket = {
    tests: [
      { name: 'a', fn: async () => { events.push('t') }, describePath: [] },
      { name: 'b', fn: async () => { events.push('t') }, describePath: [] },
    ],
    beforeEach: [],
    afterEach: [],
    beforeAll: [async () => { events.push('beforeAll') }],
    afterAll: [async () => { events.push('afterAll') }],
    use: {},
    describeStack: [],
    extendUsed: false,
  }
  await runBucket(bucket, {
    fixtures: fakeFixtures(fakePage()),
    resetBetween: async (p) => p,
  })
  expect(events).toEqual(['beforeAll', 't', 't', 'afterAll'])
})

test('reports failed tests without aborting the rest', async () => {
  const bucket = {
    tests: [
      { name: 'pass1', fn: async () => {}, describePath: [] },
      { name: 'fail', fn: async () => { throw new Error('boom') }, describePath: ['group'] },
      { name: 'pass2', fn: async () => {}, describePath: [] },
    ],
    beforeEach: [],
    afterEach: [],
    beforeAll: [],
    afterAll: [],
    use: {},
    describeStack: [],
    extendUsed: false,
  }
  const result = await runBucket(bucket, {
    fixtures: fakeFixtures(fakePage()),
    resetBetween: async (p) => p,
  })
  expect(result.ran).toBe(3)
  expect(result.passed).toBe(2)
  expect(result.failed).toBe(1)
  expect(result.errors[0].test).toBe('group › fail')
  expect(result.errors[0].message).toContain('boom')
})

test('throws clear error if spec used test.extend (custom fixtures unsupported)', async () => {
  const bucket = {
    tests: [{ name: 't', fn: async () => {}, describePath: [] }],
    beforeEach: [],
    afterEach: [],
    beforeAll: [],
    afterAll: [],
    use: {},
    describeStack: [],
    extendUsed: true,
  }
  await expect(
    runBucket(bucket, {
      fixtures: fakeFixtures(fakePage()),
      resetBetween: async (p) => p,
    }),
  ).rejects.toThrow(/test\.extend/)
})
