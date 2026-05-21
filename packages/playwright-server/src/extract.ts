// Pull the body of the first `test('...', async ({ ... }) => { ... })` block
// out of a Playwright spec file, so it can be evaluated with `new AsyncFunction`
// against a live `page`/`context` we control. The point: skip @playwright/test's
// worker spawn + global-setup + fixture machinery, run codegen-recorded clicks
// directly in our warm browser.
//
// Tradeoffs:
// - "first test() wins" — codegen output is single-test by design
// - String literals respected so a `'}'` in a selector doesn't break depth
// - Comments NOT tracked — a `// }` would close depth early. Codegen never
//   emits comments inside the test body, so accepted.

export type ExtractedTest = {
  fixtures: string[];
  body: string;
};

export function extractTestBody(source: string): ExtractedTest | null {
  // The opening must be a top-level test() call (not test.describe). The
  // negative-lookahead `(?!\.)` rules out test.describe/test.step/etc.
  const start = source.match(
    /\btest(?!\.)\s*\(\s*['"`][^'"`]*['"`]\s*,\s*async\s*\(\s*\{\s*([^}]*)\s*\}/,
  );
  if (!start || start.index === undefined) return null;
  // Walk past the optional `: { ... }` type annotation + `)` + `=> {`.
  const afterFixtureBrace = start.index + start[0].length;
  const arrowOpen = findArrowOpenBrace(source, afterFixtureBrace);
  if (arrowOpen === -1) return null;

  const fixtures = start[1]
    .split(',')
    .map((s) => s.trim().split(':')[0].trim())
    .filter(Boolean);

  // Brace-balance the body. String-literal aware (respects ' " ` and
  // backslash escapes); comment-unaware (codegen doesn't emit them inside).
  let i = arrowOpen + 1;
  let depth = 1;
  let inStr: '"' | "'" | '`' | null = null;
  let escape = false;
  const bodyStart = i;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (escape) {
      escape = false;
    } else if (inStr) {
      if (c === '\\') escape = true;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
    }
    i++;
  }
  // i points one past the closing `}`; the body excludes it.
  return { fixtures, body: source.slice(bodyStart, i - 1) };
}

// Skip whitespace, an optional TS type-annotation `: { ... }`, the closing
// `)` of the arg list, the arrow `=>`, and return the index of the body-
// opening `{`.
function findArrowOpenBrace(source: string, from: number): number {
  let i = from;
  // Optional TypeScript type annotation: `: { page: Page }`. Brace-balance
  // through it.
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] === ':') {
    i++;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === '{') {
      let d = 1;
      i++;
      while (i < source.length && d > 0) {
        if (source[i] === '{') d++;
        else if (source[i] === '}') d--;
        i++;
      }
    }
  }
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== ')') return -1;
  i++;
  // `=>`
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source.slice(i, i + 2) !== '=>') return -1;
  i += 2;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== '{') return -1;
  return i;
}
