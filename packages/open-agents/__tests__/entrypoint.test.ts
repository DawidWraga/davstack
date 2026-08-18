import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const cliSource = readFileSync(
  fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
  'utf8',
);

describe('CLI entrypoints', () => {
  test('the shared CLI module does not auto-run when bundled into a profile entrypoint', () => {
    expect(cliSource).not.toContain('import.meta.main');
    expect(cliSource).not.toMatch(/\bmain\(\)\.catch\(/);
  });
});
