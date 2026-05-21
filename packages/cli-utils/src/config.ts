// Shared helpers for resolving a repo's .davstack/ config layout.
//
// The design pins config files at `<repo-root>/.davstack/config/<tool>.config.ts`
// so a single set of configs serves a whole monorepo (trace_id correlation
// across services lives or dies by that single-root invariant). The resolver
// here walks up from a starting cwd to find the repo root, then probes the
// canonical path with a backwards-compat fallback for setups that pre-date
// the .davstack/ convention.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const WORKSPACE_MARKERS = [
  'pnpm-workspace.yaml',
  'turbo.json',
  'lerna.json',
];

/**
 * Resolve the repo root for a given starting directory.
 *
 * Order:
 *   1. `git rev-parse --show-toplevel` (most reliable; works in any subdir of a git tree)
 *   2. Walk up looking for a workspace marker (pnpm-workspace.yaml / turbo.json / lerna.json)
 *      or a package.json with a `workspaces` field
 *   3. Walk up for any package.json
 *   4. Fall back to the starting directory
 *
 * Never throws — returns `start` (or an absolute resolved form of it) if
 * nothing matches. Daemons can then decide whether the fallback is safe.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  const startAbs = resolve(start);

  // 1) git
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startAbs,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const trimmed = out.trim();
    if (trimmed) return resolve(trimmed);
  } catch {
    // not a git checkout, or git missing — fall through
  }

  // 2/3) walk up
  let cur = startAbs;
  let lastPackageJsonDir: string | undefined;
  // hard cap depth to avoid pathological mounts
  for (let depth = 0; depth < 64; depth++) {
    for (const marker of WORKSPACE_MARKERS) {
      if (existsSync(join(cur, marker))) return cur;
    }
    const pkgPath = join(cur, 'package.json');
    if (existsSync(pkgPath)) {
      // remember the deepest package.json we've seen; prefer one with workspaces
      lastPackageJsonDir = lastPackageJsonDir ?? cur;
      try {
        // tiny synchronous read is fine for a one-shot init
        const text = readFileSync(pkgPath, 'utf8');
        const json = JSON.parse(text) as { workspaces?: unknown };
        if (json.workspaces) return cur;
      } catch {
        // ignore parse errors, keep walking
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 4) fallback
  return lastPackageJsonDir ?? startAbs;
}

/**
 * Locate a tool config file. Returns the resolved absolute path or `null` if
 * nothing matches.
 *
 *
 * Resolution order:
 *   1. `<repo-root>/.davstack/config/<toolName>.config.ts` — the canonical path
 *   2. `<repo-root>/<toolName>.config.ts` — committed-at-root fallback
 *   3. `<cwd>/<toolName>.config.ts` — legacy pre-`.davstack/` convention
 */
export function findToolConfig(
  toolName: string,
  cwd: string = process.cwd(),
): string | null {
  const root = findRepoRoot(cwd);
  const primary = join(root, '.davstack', 'config', `${toolName}.config.ts`);
  if (existsSync(primary)) return primary;
  const rootFallback = join(root, `${toolName}.config.ts`);
  if (existsSync(rootFallback)) return rootFallback;
  const cwdAbs = resolve(cwd);
  if (cwdAbs !== root) {
    const cwdFallback = join(cwdAbs, `${toolName}.config.ts`);
    if (existsSync(cwdFallback)) return cwdFallback;
  }
  return null;
}
