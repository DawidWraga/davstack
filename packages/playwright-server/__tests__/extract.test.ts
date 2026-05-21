// Brace-balanced parser for codegen-style Playwright specs. Pure function,
// fully unit-testable. Edge cases below are derived from real codegen output:
// destructured fixtures with TS type annotations, template literals containing
// `}`, escape sequences in single-quoted strings (e.g. apostrophes in selectors).

import { test, expect } from 'vitest';
import { extractTestBody } from '../src/extract.ts';

test('returns null when source has no test() block', () => {
  expect(extractTestBody('// no test here\nconst x = 1')).toBeNull();
});

test('returns null when source has only a `test.describe` (not a test() call)', () => {
  expect(
    extractTestBody(`
    test.describe('group', () => {
      // no top-level test
    })
  `),
  ).toBeNull();
});

test('extracts a simple test body and its single fixture', () => {
  const source = `
    import { test } from '@playwright/test'
    test('login', async ({ page }) => {
      await page.goto('/login')
    })
  `;
  const result = extractTestBody(source)!;
  expect(result.fixtures).toEqual(['page']);
  expect(result.body.trim()).toBe(`await page.goto('/login')`);
});

test('extracts multiple destructured fixtures', () => {
  const source = `test('foo', async ({ page, context, browser }) => { x() })`;
  expect(extractTestBody(source)!.fixtures).toEqual(['page', 'context', 'browser']);
});

test('strips TypeScript fixture type annotations', () => {
  // VSCode/Playwright extension's codegen can emit `: Page` annotations.
  const source = `test('foo', async ({ page }: { page: Page }) => { x() })`;
  expect(extractTestBody(source)!.fixtures).toEqual(['page']);
});

test('balances nested braces in the body', () => {
  const source = `test('foo', async ({ page }) => {
    const obj = { a: 1, b: { c: 2 } }
    page.goto('x')
  })`;
  const body = extractTestBody(source)!.body;
  expect(body).toContain('const obj = { a: 1, b: { c: 2 } }');
  expect(body).toContain(`page.goto('x')`);
});

test("respects single-quoted strings containing '}'", () => {
  // A codegen `page.fill('input[data-x="}"]')` would otherwise trip the parser.
  const source = `test('foo', async ({ page }) => {
    await page.fill('input', '}')
  })`;
  expect(extractTestBody(source)!.body).toContain(`'}'`);
});

test('respects double-quoted strings containing }', () => {
  const source = `test('foo', async ({ page }) => {
    await page.fill("input", "}")
  })`;
  expect(extractTestBody(source)!.body).toContain(`"}"`);
});

test('respects template literals containing }', () => {
  const source = `test('foo', async ({ page }) => {
    const t = \`a}b\`
  })`;
  expect(extractTestBody(source)!.body).toContain('`a}b`');
});

test('escape sequences in strings dont confuse parser', () => {
  // A trailing `'` in an apostrophe selector would otherwise close the string
  // early and let the next `}` decrement depth prematurely.
  const source = `test('foo', async ({ page }) => {
    const t = 'a\\'b}c'
  })`;
  expect(extractTestBody(source)!.body).toContain("'a\\'b}c'");
});

test('only the first test() is extracted (codegen output is single-test)', () => {
  // Multi-test files are not what codegen produces; defining behaviour as
  // "first one wins" matches the .mjs parent and keeps the contract simple.
  const source = `
    test('one', async ({ page }) => { await page.goto('/a') })
    test('two', async ({ page }) => { await page.goto('/b') })
  `;
  expect(extractTestBody(source)!.body.trim()).toBe(`await page.goto('/a')`);
});

test('accepts double-quoted and template-literal test names', () => {
  const a = extractTestBody(`test("foo", async ({ page }) => { x() })`)!;
  expect(a.fixtures).toEqual(['page']);
  const b = extractTestBody('test(`foo`, async ({ page }) => { x() })')!;
  expect(b.fixtures).toEqual(['page']);
});

test('drops trailing whitespace inside fixture braces', () => {
  const source = `test('foo', async ({  page  ,  context  }) => { x() })`;
  expect(extractTestBody(source)!.fixtures).toEqual(['page', 'context']);
});
