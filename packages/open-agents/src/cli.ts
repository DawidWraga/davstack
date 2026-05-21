#!/usr/bin/env bun
// open-agents cli — a thin self-waiting job primitive over a CLI subagent.
// Verbs: submit | ls | tail | result | wait   (+ internal __run)
//
// The point is NOT an orchestrator. It is "make a subagent job a self-waiting,
// harness-trackable command", so one background line does everything:
//   bun cli.ts submit --file spec.md >id && \
//     bun cli.ts wait "$(cat id)" && bun cli.ts result "$(cat id)"
//
// All cursor/Windows quirks live in adapters/cursor.ts; the explore/edit prompt
// scaffolds live in profiles/. This file only parses flags, picks an adapter
// (default cursor / composer-2.5) + profile, and dispatches verbs through core/.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agyAdapter } from './adapters/agy.ts';
import { cursorAdapter } from './adapters/cursor.ts';
import { geminiAdapter } from './adapters/gemini.ts';
import type { AgentAdapter, Tier } from './adapters/types.ts';
import { readDeliverable, renderJobResult } from './core/deliverable.ts';
import {
  createJob,
  listJobs,
  mostRecentFinishedJob,
  readJob,
  updateJob,
} from './core/jobs.ts';
import { jobsDir } from './core/paths.ts';
import { DEFAULT_TIMEOUT_SEC, runJob } from './core/run.ts';
import { editProfile } from './profiles/edit.ts';
import { exploreProfile } from './profiles/explore.ts';
import type { Profile } from './profiles/types.ts';

const SELF = fileURLToPath(import.meta.url);
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

const ADAPTERS: Record<string, AgentAdapter> = {
  cursor: cursorAdapter,
  gemini: geminiAdapter,
  agy: agyAdapter,
};

function genId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(16).slice(2, 6)}`;
}

// --- flag parsing (minimal; we control all call sites) --------------------
export interface Flags {
  edit?: boolean;
  any?: boolean;
  all?: boolean;
  detach?: boolean;
  noInline?: boolean;
  tier?: Tier;
  files?: string[];
  model?: string;
  cwd?: string;
  timeout?: number;
  parallelMode?: string;
  adapter?: string;
}

export function parseFlags(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    let a = argv[i];
    let inlineVal: string | undefined;
    if (a.startsWith('--') && a.includes('=')) {
      const j = a.indexOf('=');
      inlineVal = a.slice(j + 1);
      a = a.slice(0, j);
    }
    const val = () => (inlineVal !== undefined ? inlineVal : argv[++i]);
    if (a === '--edit' || a === '--any' || a === '--all' || a === '--detach')
      (flags as any)[a.slice(2)] = true;
    else if (a === '--smarter') flags.tier = 'smarter';
    else if (a === '--faster') flags.tier = 'faster';
    else if (a === '--background' || a === '--bg' || a === '--no-wait') flags.detach = true;
    else if (a === '--no-inline') flags.noInline = true;
    else if (a === '--file') (flags.files ||= []).push(val());
    else if (a === '--model') flags.model = val();
    else if (a === '--cwd') flags.cwd = val();
    else if (a === '--timeout') flags.timeout = Number(val());
    else if (a === '--parallel-mode') flags.parallelMode = val();
    else if (a === '--adapter' || a === '--provider') flags.adapter = val();
    else positional.push(argv[i]);
  }
  return { flags, positional };
}

export function pickAdapter(flags: Flags): AgentAdapter {
  // Default: cursor (composer-2.5). Unknown adapter names fall back to cursor
  // too (no silent gemini on a typo).
  return ADAPTERS[flags.adapter || 'cursor'] || cursorAdapter;
}

// Profile precedence: an entrypoint binding (FORCED_PROFILE) wins; else
// --edit selects edit; else explore. Set by entrypoints/explore|fast-edit.ts.
let FORCED_PROFILE: Profile | null = null;
export function bindProfile(p: Profile): void {
  FORCED_PROFILE = p;
}
function pickProfile(flags: Flags): Profile {
  if (FORCED_PROFILE) return FORCED_PROFILE;
  return flags.edit ? editProfile : exploreProfile;
}

// --- submit ----------------------------------------------------------------
const SHELL_HOSTILE = /[\n"'`$();|&<>]/;

async function cmdSubmit(flags: Flags, positional: string[]): Promise<void> {
  const repoPath = flags.cwd || process.cwd();
  const adapter = pickAdapter(flags);
  const profile = pickProfile(flags);
  // Precedence: explicit raw --model > tier flag (--smarter/--faster) > default.
  const model =
    flags.model || (flags.tier && adapter.tierModel(flags.tier)) || adapter.defaultModel();
  const timeoutSec = Number.isFinite(flags.timeout) ? flags.timeout! : DEFAULT_TIMEOUT_SEC;
  // Adapter-contributed extra guard line(s) for this profile+tier (e.g. the
  // gemini-flash explore line-number-verify directive). Default adapters/tiers
  // return '' so the scaffold stays byte-identical.
  const guardAddendum = adapter.guardAddendum?.(profile.name, flags.tier) ?? '';

  // adapter pre-run hook (cursor: clear stale .test.ts litter + snapshot, so
  // the post hook removes only what THIS submit leaks). Detach's only cleanup.
  const preToken = adapter.preSpawn(repoPath);

  // Gather one or more spec bodies. Multiple --file → run them in parallel.
  const bodies: string[] = [];
  const files = flags.files || [];
  if (files.length) {
    for (const f of files) {
      if (!existsSync(f)) {
        process.stderr.write(`cursor-jobs: spec file not found: ${f}\n`);
        process.exit(2);
      }
      bodies.push(readFileSync(f, 'utf8'));
    }
  } else {
    const body = positional.join(' ').trim();
    if (!body) {
      process.stderr.write('cursor-jobs submit: need --file <spec.md> (or an inline prompt)\n');
      process.exit(2);
    }
    if (SHELL_HOSTILE.test(body)) {
      process.stderr.write(
        'cursor-jobs submit: inline prompt has shell-hostile chars. Write it to a ' +
          'file and use --file <spec.md> instead.\n',
      );
      process.exit(2);
    }
    bodies.push(body);
  }

  const ids = bodies.map((body) => {
    profile.warnIfMissingAcceptance(body);
    const id = genId();
    createJob({ id, repoPath, prompt: body.trim().slice(0, 500), model, background: true });
    updateJob(repoPath, id, {
      fullPrompt: profile.buildPrompt(body, guardAddendum),
      edit: profile.mode === 'force',
      model,
      timeoutSec,
    });
    // Durable prompt record: spec beside its <id>.result.md, paired by job id.
    try {
      writeFileSync(join(jobsDir(repoPath), `${id}.spec.md`), body.trim() + '\n', 'utf8');
    } catch {
      /* best-effort */
    }
    return id;
  });

  const deps = { adapter, profile };

  if (flags.detach) {
    for (const id of ids) {
      spawn(process.execPath, [SELF, '__run', id, repoPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    }
    process.stdout.write(ids.join('\n') + '\n');
    return;
  }

  const mode = (flags.parallelMode || 'asap').toLowerCase();
  if (mode !== 'asap' && mode !== 'all-together') {
    process.stderr.write(`cursor-jobs: --parallel-mode must be asap|all-together\n`);
    process.exit(2);
  }
  const t0 = Date.now();
  process.stderr.write(
    `cursor-jobs: ${ids.length} job(s) running (${profile.mode === 'force' ? 'edit' : 'explore'}, ${model}` +
      `${ids.length > 1 ? `, ${mode}` : ''})…\n`,
  );
  let worst = 0;
  let printed = 0;
  const inline = !flags.noInline;
  const write = (id: string) => {
    const r = renderJobResult(readJob, repoPath, id);
    if (r.code > worst) worst = r.code;
    let body = r.text;
    if (inline) {
      const job = readJob(repoPath, id);
      if (job) {
        try {
          const text = readDeliverable(adapter, job).trim();
          if (text) body += `\n--- deliverable ---\n${text}`;
        } catch {
          /* fall back to header-only on read errors */
        }
      }
    }
    process.stdout.write((printed++ ? '\n\n' : '') + body + '\n');
  };

  if (mode === 'asap' && ids.length > 1) {
    let done = 0;
    await Promise.all(
      ids.map((id) =>
        runJob(deps, repoPath, id).then(() => {
          done += 1;
          process.stderr.write(
            `cursor-jobs: [${done}/${ids.length}] ${id} done (${Math.round((Date.now() - t0) / 1000)}s)\n`,
          );
          write(id);
        }),
      ),
    );
  } else {
    await Promise.all(ids.map((id) => runJob(deps, repoPath, id)));
    for (const id of ids) write(id);
  }
  const paths = ids.map((id) => readJob(repoPath, id)?.resultPath).filter(Boolean);
  if (paths.length && !inline) {
    process.stdout.write(
      '\n--- deliverable file(s) — read each for the actual output ---\n' +
        paths.join('\n') +
        '\n',
    );
  }
  adapter.postExit(repoPath, preToken);
  process.exit(worst);
}

async function cmdRun(positional: string[], flags: Flags): Promise<void> {
  const [id, repoPath] = positional;
  // A detached runner re-derives the profile from the persisted job record so
  // it does not need the entrypoint binding to have re-run.
  const adapter = pickAdapter(flags);
  const job = readJob(repoPath, id);
  const profile = FORCED_PROFILE || (job?.edit ? editProfile : exploreProfile);
  await runJob({ adapter, profile }, repoPath, id);
  process.exit(0);
}

// --- wait ------------------------------------------------------------------
async function cmdWait(flags: Flags, positional: string[]): Promise<void> {
  const repoPath = flags.cwd || process.cwd();
  const timeoutMs =
    (Number.isFinite(flags.timeout) ? flags.timeout! : DEFAULT_TIMEOUT_SEC + 120) * 1000;
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let ids = positional.flatMap((s) => String(s).split(/\s+/)).filter(Boolean);
  if (ids.length === 0) {
    ids = listJobs(repoPath)
      .filter((j: any) => j.status === 'running')
      .map((j: any) => j.id);
    if (ids.length === 0) process.exit(0);
  } else {
    const unknown = ids.filter((id) => !readJob(repoPath, id));
    if (unknown.length) {
      process.stderr.write(`cursor-jobs wait: unknown job id(s): ${unknown.join(', ')}\n`);
      process.exit(2);
    }
  }

  const terminalIds = () =>
    ids.filter((id) => {
      const j = readJob(repoPath, id);
      return j && TERMINAL.has(j.status);
    });

  for (;;) {
    const finished = terminalIds();
    if (flags.any && finished.length) {
      process.stdout.write(finished.join('\n') + '\n');
      process.exit(0);
    }
    if (!flags.any && finished.length === ids.length) {
      process.exit(0);
    }
    if (Date.now() >= deadline) {
      process.stderr.write('cursor-jobs wait: timed out\n');
      process.exit(3);
    }
    await sleep(1500);
  }
}

// --- result ----------------------------------------------------------------
function printJobResult(adapter: AgentAdapter, repoPath: string, id: string | null): void {
  const job = id ? readJob(repoPath, id) : mostRecentFinishedJob(repoPath);
  if (!job) {
    process.stderr.write(
      id ? `No job \`${id}\` for this repo.\n` : 'No finished cursor-jobs for this repo yet.\n',
    );
    process.exit(1);
  }
  if (job.status === 'running') {
    process.stdout.write(`Job ${job.id} still running. Block with: cursor-jobs wait ${job.id}\n`);
    process.exit(0);
  }
  process.stderr.write(
    `cursor-job ${job.id} — ${job.status} (exit ${job.exitCode ?? '?'})` +
      (job.resultPath ? `  ·  ${job.resultPath}` : '') +
      '\n',
  );
  process.stdout.write(readDeliverable(adapter, job));
  process.exit(job.status === 'done' ? 0 : 1);
}

function cmdResult(flags: Flags, positional: string[]): void {
  printJobResult(pickAdapter(flags), flags.cwd || process.cwd(), positional[0] || null);
}

// --- ls --------------------------------------------------------------------
function cmdLs(flags: Flags): void {
  const repoPath = flags.cwd || process.cwd();
  const jobs = listJobs(repoPath, { limit: 20 });
  if (!jobs.length) {
    process.stdout.write('(no cursor-jobs for this repo)\n');
    return;
  }
  const now = Date.now();
  for (const j of jobs as any[]) {
    const ageMin = Math.round((now - new Date(j.startedAt).getTime()) / 60000);
    const age = ageMin < 60 ? `${ageMin}m` : `${Math.round(ageMin / 60)}h`;
    const tag = j.edit ? 'EDIT' : 'explore';
    process.stdout.write(
      `${j.id}  ${j.status.padEnd(9)} ${tag.padEnd(5)} ${age.padStart(4)}  ` +
        `${j.prompt.replace(/\s+/g, ' ').slice(0, 70)}\n`,
    );
  }
}

// --- tail ------------------------------------------------------------------
async function cmdTail(flags: Flags, positional: string[]): Promise<void> {
  const repoPath = flags.cwd || process.cwd();
  const adapter = pickAdapter(flags);
  const id = positional[0];
  const job = readJob(repoPath, id);
  if (!job) {
    process.stderr.write(`No job \`${id}\`.\n`);
    process.exit(1);
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let offset = 0;
  for (;;) {
    if (existsSync(job.rawLogPath)) {
      const txt = readFileSync(job.rawLogPath, 'utf8');
      if (txt.length > offset) {
        for (const line of txt.slice(offset).split('\n')) {
          if (!line.trim()) continue;
          const ev = adapter.parseLine(line);
          if (!ev) {
            process.stdout.write(line + '\n');
            continue;
          }
          const t = (ev as any).type || '?';
          const txtBit =
            (typeof (ev as any).text === 'string' && (ev as any).text) ||
            ((ev as any).message &&
              typeof (ev as any).message.text === 'string' &&
              (ev as any).message.text) ||
            '';
          process.stdout.write(`[${t}] ${String(txtBit).replace(/\s+/g, ' ').slice(0, 160)}\n`);
        }
        offset = txt.length;
      }
    }
    const fresh = readJob(repoPath, id);
    if (fresh && TERMINAL.has(fresh.status)) break;
    await sleep(700);
  }
  process.stdout.write(`-- job ${id} ${readJob(repoPath, id)?.status} --\n`);
}

// --- dispatch --------------------------------------------------------------
const HELP = `open-agents cli — self-waiting subagent job primitive

  submit --file a.md [--file b.md …] | "<inline>"  [--edit] [--smarter|--faster] [--model m] [--provider p] [--timeout s] [--cwd d]
           model tier: --smarter (default, composer-2.5) | --faster
             (composer-2-fast, latency-sensitive). raw --model overrides both.
           --provider cursor (default, cursor-agent, default composer-2.5)
             | gemini (Gemini CLI, default gemini-3.1-flash-lite-preview)
             | agy (Antigravity CLI; model picked by the GUI's Model
             Selection setting — --smarter/--faster are no-ops). --adapter
             is an alias.
           default: BLOCKS until all done. Each job's clean deliverable is
           written to its OWN file (<id>.result.md) AND inlined into stdout
           under a "--- deliverable ---" divider, so one read sees everything.
           Use --no-inline to keep stdout to the compact header + file paths
           only (the old behavior — useful for scripts that just parse status).
           many --file ⇒ run in parallel. --background (alias --detach, --bg,
             --no-wait): print bare id(s), don't wait, no inline output.
           --parallel-mode asap|all-together (default asap): asap prints each
             index line the moment its job finishes; all-together = submit order.
  wait                         wait for ALL running jobs in this repo
  wait   "<id…>" | <id…>       wait for ALL of these
  wait   --any <id…>           return when ≥1 done; prints which (loop = popcorn)
  result [id]                  print a job's clean deliverable (its result file)
  ls                           recent jobs for this repo
  tail   <id>                  follow a running job
  exit codes: 0 ok · 1 job failed · 2 bad id/spec · 3 wait timeout

common — ONE backgrounded, harness-tracked command (blocks, prints result(s)):
  bun cli.ts submit --file spec.md
  bun cli.ts submit --file a.md --file b.md --file c.md   # parallel
`;

export async function main(argvRest?: string[]): Promise<void> {
  const [verb, ...rest] = argvRest ?? process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  switch (verb) {
    case '__run':
      return cmdRun(positional, flags);
    case 'submit':
      return cmdSubmit(flags, positional);
    case 'wait':
      return cmdWait(flags, positional);
    case 'result':
      return cmdResult(flags, positional);
    case 'ls':
      return cmdLs(flags);
    case 'tail':
      return cmdTail(flags, positional);
    default:
      process.stdout.write(HELP);
      process.exit(verb ? 1 : 0);
  }
}

// Auto-run only when this module IS the entrypoint (direct `bun cli.ts …`,
// the transitional cursor-jobs.ts shim, or the built default bundle) — NOT
// when imported by entrypoints/*.ts (which call main() after binding a
// profile). `import.meta.main` is true for the process entry module under bun.
if (import.meta.main) {
  main().catch((err: any) => {
    process.stderr.write(`cursor-jobs: ${err?.stack || err}\n`);
    process.exit(1);
  });
}
