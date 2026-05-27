// walkLogDbs walks <repo>/.davstack/logs/ recursively, returning every *.db
// file. Used by `prune` and the daemon's hourly prune tick so cleanup stays
// global without anyone having to track the active session-DB set.

import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkLogDbs } from '../../src/db-walk.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'db-walk-'));
});

function touch(p: string): string {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, '');
  return p;
}

test('returns [] when the logs dir does not exist', () => {
  expect(walkLogDbs(dir)).toEqual([]);
});

test('lists every *.db at the top level and below', () => {
  const logs = join(dir, '.davstack', 'logs');
  touch(join(logs, 'default.db'));
  touch(join(logs, 'reorder-bug.db'));
  touch(join(logs, 'feat', 'reorder.db'));
  touch(join(logs, 'feat', 'sub', 'deep.db'));
  // non-.db files are skipped
  touch(join(logs, 'README.txt'));
  const got = walkLogDbs(dir).sort();
  expect(got).toEqual(
    [
      join(logs, 'default.db'),
      join(logs, 'feat', 'reorder.db'),
      join(logs, 'feat', 'sub', 'deep.db'),
      join(logs, 'reorder-bug.db'),
    ].sort(),
  );
});
