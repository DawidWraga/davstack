/**
 * fix-at-commits.ts
 *
 * Fixes the "@ at the start of the commit message" corruption that sometimes
 * happens when committing through PowerShell here-strings: the real first line
 * ends up as a bare `@`, pushing the true subject down to line 2. `git log`
 * then shows `@ <subject>` and any tool that shows only line 1 shows just `@`.
 *
 * What it does, carefully:
 *   - Operates ONLY on UNPUSHED commits (`git rev-list HEAD --not --remotes`).
 *     Anything already on a remote is never touched.
 *   - Refuses to run on a detached HEAD or if the unpushed range contains a
 *     merge commit (keeps us to simple linear history).
 *   - Rebuilds commits with `git commit-tree` (pure plumbing): SAME tree, SAME
 *     author + author/committer dates, only the message changes. Your working
 *     tree and index are never touched.
 *   - Dry-run by default. Pass `--apply` to actually rewrite.
 *   - Before rewriting it saves a backup ref and, after rewriting, verifies the
 *     new branch tip has a byte-identical tree to the backup. If anything looks
 *     off it aborts without moving your branch.
 *
 * Usage (from repo root):
 *   bun scripts/fix-at-commits.ts            # dry-run: show what would change
 *   bun scripts/fix-at-commits.ts --apply    # rewrite the unpushed commits
 */

import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");

function git(args: string[], opts: { input?: string } = {}): string {
  return execFileSync("git", args, {
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
}

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Strip the leading `@` corruption from a raw commit message (%B). */
function fixMessage(raw: string): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() === "@") {
    // The classic case: a bare `@` line above the real subject. Drop it.
    lines.shift();
  } else if (/^@\s+/.test(lines[0] ?? "")) {
    // Defensive: `@ subject` collapsed onto one line. Strip the prefix.
    lines[0] = lines[0].replace(/^@\s+/, "");
  } else {
    return raw; // no corruption
  }
  return lines.join("\n");
}

// ── 1. Sanity: we must be on a real branch ──────────────────────────────────
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
if (branch === "HEAD") {
  fail("HEAD is detached. Check out a branch first; refusing to rewrite.");
}

// ── 2. Collect unpushed commits, oldest → newest ────────────────────────────
const unpushed = git(["rev-list", "--reverse", "HEAD", "--not", "--remotes"])
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

if (unpushed.length === 0) {
  console.log("Nothing to do: no unpushed commits on this branch.");
  process.exit(0);
}

// ── 3. Refuse merge commits in the range (keeps the rebuild linear & safe) ──
const merges = git(["rev-list", "--reverse", "HEAD", "--not", "--remotes", "--merges"])
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
if (merges.length > 0) {
  fail(
    `Unpushed range contains merge commit(s):\n  ${merges.join("\n  ")}\n` +
      `Refusing to rewrite automatically. Fix these by hand.`,
  );
}

// ── 4. Figure out the base (parent of the oldest unpushed commit) ───────────
const oldest = unpushed[0];
const base = git(["rev-parse", `${oldest}^`]).trim();

// ── 5. Capture each commit's metadata + computed new message ────────────────
interface Plan {
  sha: string;
  tree: string;
  msg: string;
  newMsg: string;
  changed: boolean;
  an: string;
  ae: string;
  ad: string;
  cn: string;
  ce: string;
  cd: string;
}

const SEP = "\x1f"; // unit separator: legal in argv, never in names/emails/ISO dates
const plans: Plan[] = unpushed.map((sha) => {
  // Pull author/committer identity + ISO dates in one separated record.
  const rec = git([
    "show",
    "-s",
    `--format=%an${SEP}%ae${SEP}%aI${SEP}%cn${SEP}%ce${SEP}%cI`,
    sha,
  ]);
  const [an, ae, ad, cn, ce, cd] = rec.split(SEP);
  const tree = git(["rev-parse", `${sha}^{tree}`]).trim();
  const msg = git(["log", "-1", "--format=%B", sha]);
  const newMsg = fixMessage(msg);
  if (newMsg.trim().length === 0) {
    fail(`Fixing ${sha} would leave an empty message. Aborting; nothing changed.`);
  }
  return { sha, tree, msg, newMsg, changed: newMsg !== msg, an, ae, ad, cn, ce, cd };
});

const changedCount = plans.filter((p) => p.changed).length;

// ── 6. Report ───────────────────────────────────────────────────────────────
console.log(`Branch:           ${branch}`);
console.log(`Base (unchanged): ${base.slice(0, 12)}`);
console.log(`Unpushed commits: ${plans.length}`);
console.log(`Need fixing:      ${changedCount}\n`);

for (const p of plans) {
  if (!p.changed) continue;
  const before = p.msg.split("\n")[0] || "(blank)";
  const after = p.newMsg.split("\n")[0];
  console.log(`  ${p.sha.slice(0, 8)}`);
  console.log(`    before subject: ${JSON.stringify(before)}`);
  console.log(`    after  subject: ${JSON.stringify(after)}`);
}

if (changedCount === 0) {
  console.log("\nNo `@`-prefixed messages found. Nothing to do.");
  process.exit(0);
}

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply to rewrite these ${changedCount} commit(s).`);
  process.exit(0);
}

// ── 7. Backup the current tip before doing anything ─────────────────────────
const originalHead = git(["rev-parse", "HEAD"]).trim();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRef = `refs/backup/fix-at-commits/${branch}/${stamp}`;
git(["update-ref", backupRef, originalHead]);
console.log(`\nBacked up current tip → ${backupRef}`);

// ── 8. Rebuild the chain with commit-tree (does not touch working tree/index)
let parent = base;
for (const p of plans) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: p.an,
    GIT_AUTHOR_EMAIL: p.ae,
    GIT_AUTHOR_DATE: p.ad,
    GIT_COMMITTER_NAME: p.cn,
    GIT_COMMITTER_EMAIL: p.ce,
    GIT_COMMITTER_DATE: p.cd,
  };
  const newSha = execFileSync("git", ["commit-tree", p.tree, "-p", parent], {
    input: p.newMsg,
    encoding: "utf8",
    env,
  })
    .toString()
    .trim();
  parent = newSha;
}
const newHead = parent;

// ── 9. Verify the rebuilt tip is content-identical to the backup ────────────
try {
  git(["diff", "--quiet", originalHead, newHead]);
} catch {
  fail(
    `Rebuilt tree differs from the original! NOT moving ${branch}.\n` +
      `Original is safe at ${backupRef} (and your branch is unchanged).`,
  );
}
const newCount = git(["rev-list", "--count", `${base}..${newHead}`]).trim();
if (newCount !== String(plans.length)) {
  fail(
    `Commit count mismatch (${newCount} vs ${plans.length}). NOT moving ${branch}.\n` +
      `Original is safe at ${backupRef}.`,
  );
}

// ── 10. Move the branch (with old-value guard against concurrent changes) ───
git(["update-ref", "-m", "fix-at-commits: strip leading @", `refs/heads/${branch}`, newHead, originalHead]);

console.log(`\n✔ Rewrote ${changedCount} commit message(s). Trees verified identical.`);
console.log(`  ${branch}: ${originalHead.slice(0, 12)} → ${newHead.slice(0, 12)}`);
console.log(`\nIf anything looks wrong, restore with:`);
console.log(`  git reset --hard ${backupRef}`);
console.log(`Once you're happy, you can drop the backup:`);
console.log(`  git update-ref -d ${backupRef}`);
