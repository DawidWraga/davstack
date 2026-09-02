import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { JobRecord } from "../src/core/jobs.js";
import { repoHash } from "../src/core/paths.js";

const exploreEntrypoint = fileURLToPath(
  new URL("../src/entrypoints/explore.ts", import.meta.url),
);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("automatic history background submission", () => {
  test("accepts punctuation safely and returns one executor with direct history", async () => {
    const sandbox = mkdtempSync(
      join(tmpdir(), "open-agents-compact-background-"),
    );
    const repo = join(sandbox, "repo");
    const state = join(sandbox, "state");
    const history = join(sandbox, "history.jsonl");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "package.json"), "{}\n");
    writeFileSync(
      history,
      `${JSON.stringify({ role: "user", content: "context" })}\n`,
    );

    try {
      const task = `review Juno's "voice" via $path; keep | and & literal`;
      const run = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          exploreEntrypoint,
          "submit",
          "--task",
          task,
          "--history-file",
          history,
          "--background",
          "--cwd",
          repo,
        ],
        {
          cwd: dirname(dirname(dirname(exploreEntrypoint))),
          encoding: "utf8",
          env: {
            ...process.env,
            OPEN_AGENTS_HOME: state,
            CURSOR_AGENT_BIN: join(sandbox, "missing-agent"),
          },
          timeout: 10_000,
          windowsHide: true,
        },
      );

      expect(run.error).toBeUndefined();
      expect(run.status).toBe(0);
      const ids = run.stdout.trim().split(/\s+/).filter(Boolean);
      expect(ids).toHaveLength(1);

      const jobDir = join(state, "jobs", repoHash(repo));
      const jobPath = join(jobDir, `${ids[0]}.json`);
      expect(existsSync(jobPath)).toBe(true);
      const accepted = JSON.parse(readFileSync(jobPath, "utf8")) as JobRecord;
      expect(accepted.prompt).toBe(task);
      expect(accepted.compactTask).toBeUndefined();
      expect(accepted.historyMode).toBe("direct");
      expect(accepted.fullPrompt).toContain("Read the complete delegated task");
      expect(["running", "failed"]).toContain(accepted.status);

      const spec = readFileSync(join(jobDir, `${ids[0]}.spec.md`), "utf8");
      expect(spec).toContain(`# Authoritative task\n${task}`);
      expect(spec).toContain("User:\ncontext");

      let settled = accepted;
      for (
        let attempt = 0;
        attempt < 50 && settled.status === "running";
        attempt += 1
      ) {
        await delay(100);
        settled = JSON.parse(readFileSync(jobPath, "utf8")) as JobRecord;
      }
      expect(settled.status).toBe("failed");

      const records = readdirSync(jobDir)
        .filter((name) => name.endsWith(".json"))
        .map(
          (name) =>
            JSON.parse(readFileSync(join(jobDir, name), "utf8")) as JobRecord,
        );
      expect(
        records.filter((job) => job.prompt === task),
      ).toHaveLength(1);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 20_000);
});
