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
// (default cursor) + profile, and dispatches verbs through core/.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agyAdapter } from "./adapters/agy.js";
import { cursorAdapter } from "./adapters/cursor.js";
import { geminiAdapter } from "./adapters/gemini.js";
import type { AgentAdapter } from "./adapters/types.js";
import {
  buildHistoryCuratorTask,
  DEFAULT_DIRECT_HISTORY_TOKENS,
  historyNeedsCuration,
  loadConversationHistory,
  parseCuratedHistory,
  resolveConversationHistoryFile,
  type ConversationHistory,
} from "./core/history.js";
import { readDeliverable, renderJobResult } from "./core/deliverable.js";
import {
  createJob,
  listJobs,
  mostRecentFinishedJob,
  readJob,
  updateJob,
} from "./core/jobs.js";
import { jobsDir } from "./core/paths.js";
import { DEFAULT_TIMEOUT_SEC, runJob } from "./core/run.js";
import { editProfile } from "./profiles/edit.js";
import { exploreProfile } from "./profiles/explore.js";
import { historyCuratorProfile } from "./profiles/history-curator.js";
import type { Profile } from "./profiles/types.js";
import { loadConfig } from "./config.js";
import { runCheck } from "./check.js";

const SELF = process.argv[1]
  ? resolve(process.argv[1])
  : fileURLToPath(import.meta.url);
const TERMINAL = new Set(["done", "failed", "cancelled"]);

const ADAPTERS: Record<string, AgentAdapter> = {
  cursor: cursorAdapter,
  gemini: geminiAdapter,
  agy: agyAdapter,
};

function genId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
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
  files?: string[];
  tasks?: string[];
  model?: string;
  cwd?: string;
  timeout?: number;
  parallelMode?: string;
  adapter?: string;
  compactMode?: boolean;
  historyFile?: string;
  noHistory?: boolean;
  includeRelevantHistory?: boolean;
  json?: boolean;
  unknownOptions?: string[];
}

export function parseFlags(argv: string[]): {
  flags: Flags;
  positional: string[];
} {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    let a = argv[i];
    let inlineVal: string | undefined;
    if (a.startsWith("--") && a.includes("=")) {
      const j = a.indexOf("=");
      inlineVal = a.slice(j + 1);
      a = a.slice(0, j);
    }
    const val = () => (inlineVal !== undefined ? inlineVal : argv[++i]);
    if (a === "--edit" || a === "--any" || a === "--all" || a === "--detach")
      (flags as any)[a.slice(2)] = true;
    else if (a === "--compact-mode") flags.compactMode = true;
    else if (a === "--include-relevant-history")
      flags.includeRelevantHistory = true;
    else if (a === "--no-history") flags.noHistory = true;
    else if (a === "--background" || a === "--bg" || a === "--no-wait")
      flags.detach = true;
    else if (a === "--no-inline") flags.noInline = true;
    else if (a === "--file" || a === "--spec-file")
      (flags.files ||= []).push(val());
    else if (a === "--task") (flags.tasks ||= []).push(val());
    else if (a === "--model") flags.model = val();
    else if (a === "--cwd") flags.cwd = val();
    else if (a === "--timeout") flags.timeout = Number(val());
    else if (a === "--parallel-mode") flags.parallelMode = val();
    else if (a === "--adapter" || a === "--provider") flags.adapter = val();
    else if (a === "--history-file") flags.historyFile = val();
    else if (a === "--json") flags.json = true;
    else if (a.startsWith("--")) (flags.unknownOptions ||= []).push(a);
    else positional.push(argv[i]);
  }
  return { flags, positional };
}

// Concat the two scaffold injections — adapter-contributed guard (e.g.
// gemini-flash line-verify) + repo-level systemPromptExtension from
// .davstack/config/open-agents.config.ts. Order: adapter first (provider-
// specific), user extension last (most-specific override). Both default to ''
// so goldens stay byte-identical when neither is set. The user extension is
// normalized to a trailing newline so the scaffold's `<spec>` separator stays
// on its own line; an adapter addendum is already expected to be newline-
// terminated by its author.
export function combineAddendums(
  adapterAddendum: string,
  userExtension: string,
): string {
  const normalized =
    userExtension && !userExtension.endsWith("\n")
      ? userExtension + "\n"
      : userExtension;
  return adapterAddendum + normalized;
}

export function pickAdapter(
  flags: Flags,
  configAdapter?: string,
): AgentAdapter {
  // Default: cursor. Unknown adapter names fall back to cursor
  // too (no silent gemini on a typo). Flag wins over config; config wins over
  // built-in default.
  const name = flags.adapter || configAdapter || "cursor";
  return ADAPTERS[name] || cursorAdapter;
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
function userPath(path: string): string {
  const home = homedir();
  const normalized = path.replace(/\\/g, "/");
  const normalizedHome = home.replace(/\\/g, "/");
  if (normalized === normalizedHome) return "~";
  if (normalized.startsWith(`${normalizedHome}/`)) {
    return `~/${normalized.slice(normalizedHome.length + 1)}`;
  }
  return normalized;
}

function resolveConversationHistory(flags: Flags): ConversationHistory | null {
  if (flags.noHistory) return null;
  const historyFile = resolveConversationHistoryFile({
    historyFile: flags.historyFile,
  });
  if (!historyFile) {
    process.stderr.write(
      "open-agents: no exact current-session history found; continuing task-only (use --history-file to provide one)\n",
    );
    return null;
  }
  const history = loadConversationHistory(historyFile);
  if (!history.text) {
    process.stderr.write(
      `open-agents: current-session history contained no visible user/assistant messages; continuing task-only (${userPath(history.path)})\n`,
    );
    return null;
  }
  return history;
}

async function generateRelevantHistory(input: {
  repoPath: string;
  timeoutSec: number;
  tasks: Array<{ taskId: string; task: string }>;
  history: ConversationHistory;
}): Promise<Map<string, string>> {
  const adapter = cursorAdapter;
  const model = cursorAdapter.defaultModel();
  const curatorTask = buildHistoryCuratorTask({
    tasks: input.tasks,
    historyPath: input.history.path,
    historyText: input.history.text,
  });
  const id = genId();
  const curatorTaskPath = join(jobsDir(input.repoPath), `${id}.history.md`);
  createJob({
    id,
    repoPath: input.repoPath,
    prompt: `select relevant history for ${input.tasks.length} task(s)`,
    model,
    background: true,
  });
  try {
    writeFileSync(curatorTaskPath, curatorTask.trim() + "\n", "utf8");
  } catch {
    /* best-effort */
  }

  const curatorWrapper = [
    "Read the complete history-selection task from this file:",
    "",
    curatorTaskPath,
    "",
    "Return only the strict JSON mapping requested by that file.",
  ].join("\n");

  updateJob(input.repoPath, id, {
    fullPrompt: historyCuratorProfile.buildPrompt(curatorWrapper),
    edit: false,
    model,
    timeoutSec: input.timeoutSec,
    historyMode: "curated",
    historyTokens: input.history.tokens,
  });

  process.stderr.write(
    `open-agents: history exceeds ${DEFAULT_DIRECT_HISTORY_TOKENS} tokens; selecting context for ${input.tasks.length} task(s) in one curator run (${adapter.name}, ${model}) ...\n`,
  );
  const preToken = adapter.preSpawn(input.repoPath);
  const curatorStartedAt = Date.now();
  await runJob(
    { adapter, profile: historyCuratorProfile, env: {} },
    input.repoPath,
    id,
  );
  const curatorElapsedSec = Math.round((Date.now() - curatorStartedAt) / 1000);
  adapter.postExit(input.repoPath, preToken);
  const job = readJob(input.repoPath, id);
  if (!job || job.status !== "done") {
    throw new Error(`history curator failed: ${id}`);
  }
  const generated = readDeliverable(adapter, job).trim();
  if (!generated || generated === "(no final message captured)") {
    throw new Error(`history curator produced no context: ${id}`);
  }
  const contexts = parseCuratedHistory(
    generated,
    input.tasks.map(({ taskId }) => taskId),
  );
  process.stderr.write(
    `open-agents: selected task-specific history in ${curatorElapsedSec}s -> ${userPath(job.resultPath || "")}\n`,
  );
  return contexts;
}

// A curator failure (bad model output, parse error, nonzero exit) must never
// fail the submit itself: degrade to task-only context (as if --no-history)
// with a single stderr warning, exactly like the manual retry users fell back
// to. Exported for tests; `curate` is the real generateRelevantHistory call.
export async function selectTaskContexts(input: {
  curate: () => Promise<Map<string, string>>;
  warn: (message: string) => void;
}): Promise<{ contexts: Map<string, string>; failed: boolean }> {
  try {
    return { contexts: await input.curate(), failed: false };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    input.warn(
      `open-agents: history curation failed (${detail}); continuing without conversation history (as if --no-history)\n`,
    );
    return { contexts: new Map(), failed: true };
  }
}

function buildExecutorSpec(task: string, relevantHistory: string): string {
  if (!relevantHistory.trim()) return task.trim();
  return [
    "# Authoritative task",
    task.trim(),
    "",
    "# Supporting conversation history",
    "Use this only to interpret the task. Newer decisions override older ones.",
    relevantHistory.trim(),
  ].join("\n");
}

function buildExecutorFileWrapper(specPath: string): string {
  return [
    "Read the complete delegated task and its optional conversation context from:",
    "",
    specPath,
    "",
    "The task section is authoritative. Use conversation history only as supporting context, then execute the task.",
  ].join("\n");
}

function spawnDetachedRuns(ids: string[], repoPath: string): void {
  for (const id of ids) {
    spawn(
      process.execPath,
      [...process.execArgv, SELF, "__run", id, repoPath],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env },
      },
    ).unref();
  }
}

async function cmdSubmit(flags: Flags, positional: string[]): Promise<void> {
  const repoPath = flags.cwd || process.cwd();
  // Config provides defaults BELOW flags but ABOVE built-ins. Loaded once per
  // submit — cheap, single tiny dynamic import. Resolution order:
  //   explicit --model > config > adapter built-in
  const config = await loadConfig(repoPath);
  const adapter = pickAdapter(flags, config.defaultAdapter);
  const profile = pickProfile(flags);
  const model = flags.model || config.defaultModel || adapter.defaultModel();
  const timeoutSec = Number.isFinite(flags.timeout)
    ? flags.timeout!
    : config.defaultTimeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const adapterAddendum = adapter.guardAddendum?.(profile.name, model) ?? "";
  const profileKey = profile.name as "explore" | "edit";
  const userExtension =
    config.profiles?.[profileKey]?.systemPromptExtension ?? "";
  const guardAddendum = combineAddendums(adapterAddendum, userExtension);

  // Gather one or more spec bodies. Multiple --file → run them in parallel.
  const bodies: string[] = [];
  const files = flags.files || [];
  for (const f of files) {
    if (!existsSync(f)) {
      process.stderr.write(`open-agents: spec file not found: ${f}\n`);
      process.exit(2);
    }
    bodies.push(readFileSync(f, "utf8"));
  }
  const inlineBodies = [...(flags.tasks || [])];
  const positionalBody = positional.join(" ").trim();
  if (positionalBody) inlineBodies.push(positionalBody);
  for (const body of inlineBodies) {
    bodies.push(body);
  }
  if (!bodies.length) {
    process.stderr.write(
      "open-agents submit: need --task <instruction>, --spec-file <spec.md>, or an inline prompt\n",
    );
    process.exit(2);
  }

  const history = resolveConversationHistory(flags);
  const needsCuration = Boolean(
    history && historyNeedsCuration(history.tokens),
  );
  if (history && !needsCuration) {
    process.stderr.write(
      `open-agents: including current-session history directly (${history.tokens} token-like units, ${userPath(history.path)})\n`,
    );
  }

  const createRunRecord = (
    task: string,
    relevantHistory: string,
    historyMode: "none" | "direct" | "curated",
    pendingHistory?: ConversationHistory,
  ): string => {
    profile.warnIfMissingAcceptance(task);
    const id = genId();
    createJob({
      id,
      repoPath,
      prompt: task.trim().slice(0, 500),
      model,
      background: true,
    });
    const specPath = join(jobsDir(repoPath), `${id}.spec.md`);
    if (!pendingHistory) {
      writeFileSync(
        specPath,
        buildExecutorSpec(task, relevantHistory) + "\n",
        "utf8",
      );
    }
    updateJob(repoPath, id, {
      ...(pendingHistory
        ? {
            historyTask: task,
            historySourceFile: pendingHistory.path,
          }
        : {
            fullPrompt: profile.buildPrompt(
              buildExecutorFileWrapper(specPath),
              guardAddendum,
            ),
          }),
      edit: profile.mode === "force",
      model,
      timeoutSec,
      adapterName: adapter.name,
      historyMode,
      historyTokens: pendingHistory?.tokens ?? history?.tokens,
    });
    return id;
  };

  // Oversized detached submissions keep the durable-ID-before-work guarantee.
  // Each runner selects its own context because batching would delay ID return
  // and recreate the duplicate-submit failure mode.
  if (flags.detach && history && needsCuration) {
    const ids = bodies.map((task) =>
      createRunRecord(task, "", "curated", history),
    );
    spawnDetachedRuns(ids, repoPath);
    process.stdout.write(ids.join("\n") + "\n");
    return;
  }

  const tasks = bodies.map((task, index) => ({
    taskId: `task-${index + 1}`,
    task,
  }));
  let taskContexts = new Map<string, string>();
  let curationFailed = false;
  if (history && needsCuration) {
    const selected = await selectTaskContexts({
      curate: () =>
        generateRelevantHistory({
          repoPath,
          timeoutSec,
          tasks,
          history,
        }),
      warn: (message) => process.stderr.write(message),
    });
    taskContexts = selected.contexts;
    curationFailed = selected.failed;
  }

  const ids = tasks.map(({ taskId, task }) => {
    const relevantHistory =
      history && !curationFailed
        ? needsCuration
          ? taskContexts.get(taskId) ?? ""
          : history.text
        : "";
    return createRunRecord(
      task,
      relevantHistory,
      history && !curationFailed
        ? needsCuration
          ? "curated"
          : "direct"
        : "none",
    );
  });

  const deps = { adapter, profile, env: {} };

  if (flags.detach) {
    spawnDetachedRuns(ids, repoPath);
    process.stdout.write(ids.join("\n") + "\n");
    return;
  }

  const preToken = adapter.preSpawn(repoPath);

  const mode = (flags.parallelMode || "asap").toLowerCase();
  if (mode !== "asap" && mode !== "all-together") {
    process.stderr.write(
      `open-agents: --parallel-mode must be asap|all-together\n`,
    );
    process.exit(2);
  }
  const t0 = Date.now();
  process.stderr.write(
    `open-agents: ${ids.length} job(s) running (${profile.mode === "force" ? "edit" : "explore"}, ${model}` +
      `${ids.length > 1 ? `, ${mode}` : ""})…\n`,
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
    process.stdout.write((printed++ ? "\n\n" : "") + body + "\n");
  };

  if (mode === "asap" && ids.length > 1) {
    let done = 0;
    await Promise.all(
      ids.map((id) =>
        runJob(deps, repoPath, id).then(() => {
          done += 1;
          process.stderr.write(
            `open-agents: [${done}/${ids.length}] ${id} done (${Math.round((Date.now() - t0) / 1000)}s)\n`,
          );
          write(id);
        }),
      ),
    );
  } else {
    await Promise.all(ids.map((id) => runJob(deps, repoPath, id)));
    for (const id of ids) write(id);
  }
  const paths = ids
    .map((id) => readJob(repoPath, id)?.resultPath)
    .filter(Boolean);
  if (paths.length && !inline) {
    process.stdout.write(
      "\n--- deliverable file(s) — read each for the actual output ---\n" +
        paths.join("\n") +
        "\n",
    );
  }
  adapter.postExit(repoPath, preToken);
  // Tail-stable sentinel: when a parent runner captures only the last few KB
  // of our stdout (e.g. Claude Code's backgrounded-subagent `.output` file
  // tail-truncates around ~1.3KB), the `result → <path>` header line is far
  // too high in the body to survive. Emit one `RESULT_PATH:` line per job as
  // the very last thing on stdout so a single grep recovers the pointer
  // regardless of how aggressively the transport truncates.
  for (const p of paths) {
    process.stdout.write(`RESULT_PATH: ${p}\n`);
  }
  process.exit(worst);
}

async function cmdRun(positional: string[], flags: Flags): Promise<void> {
  const [id, repoPath] = positional;
  // A detached runner re-derives the profile from the persisted job record so
  // it does not need the entrypoint binding to have re-run.
  const job = readJob(repoPath, id);
  if (!job) process.exit(1);
  const adapter =
    (job.adapterName && ADAPTERS[job.adapterName]) || pickAdapter(flags);
  const profile = FORCED_PROFILE || (job?.edit ? editProfile : exploreProfile);

  const pendingHistoryTask = job.historyTask ?? job.compactTask;
  const pendingHistoryFile = job.historySourceFile ?? job.compactHistoryFile;
  if (pendingHistoryTask) {
    // History preparation is best-effort: any failure (missing transcript,
    // curator crash, unparsable curator output) degrades to running the task
    // without conversation history instead of failing the job outright.
    let relevantHistory = "";
    let historyMode: "none" | "direct" | "curated" = "none";
    let historyTokens: number | undefined;
    try {
      if (!pendingHistoryFile)
        throw new Error("history source path is missing");
      const history = loadConversationHistory(pendingHistoryFile);
      if (historyNeedsCuration(history.tokens)) {
        const selected = await selectTaskContexts({
          curate: () =>
            generateRelevantHistory({
              repoPath,
              timeoutSec: job.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
              tasks: [{ taskId: "task-1", task: pendingHistoryTask }],
              history,
            }),
          warn: (message) => process.stderr.write(message),
        });
        if (!selected.failed) {
          relevantHistory = selected.contexts.get("task-1") ?? "";
          historyMode = "curated";
        }
      } else {
        relevantHistory = history.text;
        historyMode = "direct";
      }
      historyTokens = history.tokens;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `open-agents: history preparation failed (${detail}); running task without conversation history\n`,
      );
    }
    try {
      const config = await loadConfig(repoPath);
      const adapterAddendum =
        adapter.guardAddendum?.(profile.name, job.model) ?? "";
      const profileKey = profile.name as "explore" | "edit";
      const userExtension =
        config.profiles?.[profileKey]?.systemPromptExtension ?? "";
      const specPath = join(jobsDir(repoPath), `${id}.spec.md`);
      writeFileSync(
        specPath,
        buildExecutorSpec(pendingHistoryTask, relevantHistory) + "\n",
        "utf8",
      );
      updateJob(repoPath, id, {
        fullPrompt: profile.buildPrompt(
          buildExecutorFileWrapper(specPath),
          combineAddendums(adapterAddendum, userExtension),
        ),
        historyTask: undefined,
        historySourceFile: undefined,
        compactTask: undefined,
        compactHistoryFile: undefined,
        historyMode,
        historyTokens,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const resultPath = join(jobsDir(repoPath), `${id}.result.md`);
      try {
        writeFileSync(
          resultPath,
          `executor spec preparation failed: ${detail}\n`,
          "utf8",
        );
      } catch {
        /* best-effort */
      }
      updateJob(repoPath, id, {
        status: "failed",
        exitCode: 1,
        finishedAt: new Date().toISOString(),
        summary: `executor spec preparation failed: ${detail}`,
        resultPath,
      });
      process.exit(1);
    }
  }

  const preToken = adapter.preSpawn(repoPath);
  await runJob({ adapter, profile }, repoPath, id);
  adapter.postExit(repoPath, preToken);
  process.exit(0);
}

// --- wait ------------------------------------------------------------------
async function cmdWait(flags: Flags, positional: string[]): Promise<void> {
  const repoPath = flags.cwd || process.cwd();
  const timeoutMs =
    (Number.isFinite(flags.timeout)
      ? flags.timeout!
      : DEFAULT_TIMEOUT_SEC + 120) * 1000;
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let ids = positional.flatMap((s) => String(s).split(/\s+/)).filter(Boolean);
  if (ids.length === 0) {
    ids = listJobs(repoPath)
      .filter((j: any) => j.status === "running")
      .map((j: any) => j.id);
    if (ids.length === 0) process.exit(0);
  } else {
    const unknown = ids.filter((id) => !readJob(repoPath, id));
    if (unknown.length) {
      process.stderr.write(
        `open-agents wait: unknown job id(s): ${unknown.join(", ")}\n`,
      );
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
      process.stdout.write(finished.join("\n") + "\n");
      process.exit(0);
    }
    if (!flags.any && finished.length === ids.length) {
      process.exit(0);
    }
    if (Date.now() >= deadline) {
      process.stderr.write("open-agents wait: timed out\n");
      process.exit(3);
    }
    await sleep(1500);
  }
}

// --- result ----------------------------------------------------------------
function printJobResult(
  adapter: AgentAdapter,
  repoPath: string,
  id: string | null,
): void {
  const job = id ? readJob(repoPath, id) : mostRecentFinishedJob(repoPath);
  if (!job) {
    process.stderr.write(
      id
        ? `No job \`${id}\` for this repo.\n`
        : "No finished open-agents for this repo yet.\n",
    );
    process.exit(1);
  }
  if (job.status === "running") {
    process.stdout.write(
      `Job ${job.id} still running. Block with: open-agents wait ${job.id}\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `open-agent ${job.id} — ${job.status} (exit ${job.exitCode ?? "?"})` +
      (job.resultPath ? `  ·  ${job.resultPath}` : "") +
      "\n",
  );
  process.stdout.write(readDeliverable(adapter, job));
  process.exit(job.status === "done" ? 0 : 1);
}

function cmdResult(flags: Flags, positional: string[]): void {
  printJobResult(
    pickAdapter(flags),
    flags.cwd || process.cwd(),
    positional[0] || null,
  );
}

// --- ls --------------------------------------------------------------------
function cmdLs(flags: Flags): void {
  const repoPath = flags.cwd || process.cwd();
  const jobs = listJobs(repoPath, { limit: 20 });
  if (!jobs.length) {
    process.stdout.write("(no open-agents for this repo)\n");
    return;
  }
  const now = Date.now();
  for (const j of jobs as any[]) {
    const ageMin = Math.round((now - new Date(j.startedAt).getTime()) / 60000);
    const age = ageMin < 60 ? `${ageMin}m` : `${Math.round(ageMin / 60)}h`;
    const tag = j.edit ? "EDIT" : "explore";
    process.stdout.write(
      `${j.id}  ${j.status.padEnd(9)} ${tag.padEnd(5)} ${age.padStart(4)}  ` +
        `${j.prompt.replace(/\s+/g, " ").slice(0, 70)}\n`,
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
      const txt = readFileSync(job.rawLogPath, "utf8");
      if (txt.length > offset) {
        for (const line of txt.slice(offset).split("\n")) {
          if (!line.trim()) continue;
          const ev = adapter.parseLine(line);
          if (!ev) {
            process.stdout.write(line + "\n");
            continue;
          }
          const t = (ev as any).type || "?";
          const txtBit =
            (typeof (ev as any).text === "string" && (ev as any).text) ||
            ((ev as any).message &&
              typeof (ev as any).message.text === "string" &&
              (ev as any).message.text) ||
            "";
          process.stdout.write(
            `[${t}] ${String(txtBit).replace(/\s+/g, " ").slice(0, 160)}\n`,
          );
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

  submit --task "<short instruction>" | --spec-file a.md [--spec-file b.md …] | "<inline>"
           [--no-history] [--edit] [--model <id>] [--provider p] [--timeout s] [--cwd d]
           --model <id>: use a specific provider model for this submission.
             Overrides defaultModel in config and the provider's built-in default.
           --provider cursor (default, cursor-agent, default cursor-grok-4.6-high-fast)
             | gemini (Gemini CLI, default gemini-3.1-flash-lite-preview)
             | agy (Antigravity CLI; model picked by the GUI's Model
             Selection setting; it has no CLI model override). --adapter is an alias.
           default: BLOCKS until all done. Each job's clean deliverable is
           written to its OWN file (<id>.result.md) AND inlined into stdout
           under a "--- deliverable ---" divider, so one read sees everything.
           Use --no-inline to keep stdout to the compact header + file paths
           only (the old behavior — useful for scripts that just parse status).
           --task and --spec-file may repeat; many inputs run in parallel.
           --file remains an alias for --spec-file.
           --background (alias --detach, --bg,
             --no-wait): print bare id(s), don't wait, no inline output.
           --parallel-mode asap|all-together (default asap): asap prints each
             index line the moment its job finishes; all-together = submit order.
           current-session conversation history is included automatically.
             Up to 100000 token-like units are handed to the executor directly.
             Larger histories use one curator run to select a separate relevant
             context for each foreground task; the original task stays verbatim.
             Exact sessions resolve from --history-file <path>,
             OPEN_AGENTS_HISTORY_FILE, CLAUDE_CODE_TRANSCRIPT_PATH /
             CLAUDE_CODE_SESSION_ID, CODEX_TRANSCRIPT_PATH / CODEX_THREAD_ID,
             or explicit Cursor transcript variables. There is no newest-file
             fallback. If no exact session is available, submission continues
             task-only with a warning. --no-history disables history explicitly.
             --include-relevant-history and --compact-mode remain compatibility
             aliases for the default history behavior.
  wait                         wait for ALL running jobs in this repo
  wait   "<id…>" | <id…>       wait for ALL of these
  wait   --any <id…>           return when ≥1 done; prints which (loop = popcorn)
  result [id]                  print a job's clean deliverable (its result file)
  ls                           recent jobs for this repo
  tail   <id>                  follow a running job
  exit codes: 0 ok · 1 job failed · 2 bad id/spec · 3 wait timeout

common — ONE backgrounded, harness-tracked command (blocks, prints result(s)):
  explore submit --task "review LiveKit realtime architecture"
  explore submit --spec-file a.md --spec-file b.md --spec-file c.md   # parallel
`;

export async function main(argvRest?: string[]): Promise<void> {
  const [verb, ...rest] = argvRest ?? process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  if (flags.unknownOptions?.length) {
    process.stderr.write(
      `open-agents: unsupported option(s): ${flags.unknownOptions.join(", ")}. See --help.\n`,
    );
    process.exit(2);
  }
  switch (verb) {
    case "__run":
      return cmdRun(positional, flags);
    case "submit":
      return cmdSubmit(flags, positional);
    case "wait":
      return cmdWait(flags, positional);
    case "result":
      return cmdResult(flags, positional);
    case "ls":
      return cmdLs(flags);
    case "tail":
      return cmdTail(flags, positional);
    case "check": {
      const code = await runCheck({
        json: flags.json,
        cwd: flags.cwd,
      });
      process.exit(code);
    }
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(HELP);
      process.exit(0);
    default:
      process.stdout.write(HELP);
      process.exit(verb ? 1 : 0);
  }
}

// Intentionally no top-level invocation here. This module is bundled into the
// profile entrypoints, which bind their profile and call main() exactly once.
