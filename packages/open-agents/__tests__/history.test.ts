import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHistoryCuratorTask,
  DEFAULT_DIRECT_HISTORY_TOKENS,
  findClaudeTranscriptBySession,
  findCodexTranscriptBySession,
  historyNeedsCuration,
  loadConversationHistory,
  parseConversationMessages,
  parseCuratedHistory,
  resolveConversationHistoryFile,
} from "../src/core/history.js";
import { parseFlags, selectTaskContexts } from "../src/cli.js";

describe("conversation history helpers", () => {
  test("compact flags parse", () => {
    const { flags, positional } = parseFlags([
      "--compact-mode",
      "--history-file",
      "C:/history.jsonl",
      "short task",
    ]);
    expect(flags.compactMode).toBe(true);
    expect(flags.historyFile).toBe("C:/history.jsonl");
    expect(positional).toEqual(["short task"]);
  });

  test("automatic history flags and task aliases parse", () => {
    const parsed = parseFlags([
      "--task",
      "review architecture",
      "--spec-file",
      "follow-up.md",
      "--include-relevant-history",
    ]);
    expect(parsed.flags.tasks).toEqual(["review architecture"]);
    expect(parsed.flags.files).toEqual(["follow-up.md"]);
    expect(parsed.flags.includeRelevantHistory).toBe(true);
    expect(parseFlags(["--no-history", "task"]).flags.noHistory).toBe(true);
  });

  test("model override parses explicitly and unsupported options stay out of the prompt", () => {
    const parsed = parseFlags([
      "--model",
      "provider-model",
      "--typo",
      "short task",
    ]);
    expect(parsed.flags.model).toBe("provider-model");
    expect(parsed.flags.unknownOptions).toEqual(["--typo"]);
    expect(parsed.positional).toEqual(["short task"]);
  });

  test("extracts visible Codex conversation events without tool trace noise", () => {
    const messages = parseConversationMessages(
      [
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            output: "large tool output",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "review the voice design" },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "I will inspect it",
            phase: "commentary",
          },
        }),
      ].join("\n"),
    );

    expect(messages).toEqual([
      { role: "user", content: "review the voice design" },
      { role: "assistant", content: "I will inspect it" },
    ]);
  });

  test("extracts visible Claude messages and omits tool blocks", () => {
    const messages = parseConversationMessages(
      [
        JSON.stringify({
          message: {
            role: "user",
            content: [
              { type: "text", text: "keep this request" },
              { type: "tool_result", content: "omit tool output" },
            ],
          },
        }),
        JSON.stringify({
          message: { role: "assistant", content: "keep this response" },
        }),
      ].join("\n"),
    );

    expect(messages).toEqual([
      { role: "user", content: "keep this request" },
      { role: "assistant", content: "keep this response" },
    ]);
  });

  test("loads the full visible conversation without compacting or raw-JSON fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "conversation-history-"));
    try {
      const historyFile = join(dir, "rollout.jsonl");
      writeFileSync(
        historyFile,
        [
          JSON.stringify({
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "keep this exact request",
            },
          }),
          JSON.stringify({
            type: "event_msg",
            payload: { type: "agent_message", message: "and this response" },
          }),
        ].join("\n"),
      );
      const history = loadConversationHistory(historyFile);
      expect(history.text).toContain("User:\nkeep this exact request");
      expect(history.text).toContain("Assistant:\nand this response");
      expect(history.tokens).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("curates only above the direct-history budget", () => {
    expect(historyNeedsCuration(DEFAULT_DIRECT_HISTORY_TOKENS)).toBe(false);
    expect(historyNeedsCuration(DEFAULT_DIRECT_HISTORY_TOKENS + 1)).toBe(true);
  });

  test("keeps curator output isolated by task id", () => {
    const task = buildHistoryCuratorTask({
      tasks: [
        { taskId: "task-1", task: "review voice" },
        { taskId: "task-2", task: "rename adapter" },
      ],
      historyPath: "C:/history.jsonl",
      historyText: "User:\ncontext",
    });
    expect(task).toContain("Do not create\none shared summary");
    const contexts = parseCuratedHistory(
      JSON.stringify({
        contexts: [
          { taskId: "task-1", relevantHistory: "voice only" },
          { taskId: "task-2", relevantHistory: "adapter only" },
        ],
      }),
      ["task-1", "task-2"],
    );
    expect(contexts.get("task-1")).toBe("voice only");
    expect(contexts.get("task-2")).toBe("adapter only");
  });

  test("parses curator output despite preamble, glued sentinel, and trailing junk", () => {
    const valid = JSON.stringify({
      contexts: [{ taskId: "task-1", relevantHistory: "keep this" }],
    });
    // Observed live failure shape: prose with a glued (non-whole-line)
    // sentinel, then the JSON object, then a stray `}` + `<|eos|>` artifact
    // on the next line — one complete JSON value followed by more content.
    const output = `Reading the task file now.___FINAL_OUTPUT___\n${valid}\n}<|eos|>\n`;
    const contexts = parseCuratedHistory(output, ["task-1"]);
    expect(contexts.get("task-1")).toBe("keep this");
  });

  test("still rejects curator output with no usable JSON", () => {
    expect(() => parseCuratedHistory("no json here", ["task-1"])).toThrow(
      "history curator returned no JSON object",
    );
    expect(() => parseCuratedHistory('{"other":1}', ["task-1"])).toThrow(
      "history curator JSON is missing contexts",
    );
  });

  test("curator failure degrades to no-history instead of failing the submit", async () => {
    const warnings: string[] = [];
    const failed = await selectTaskContexts({
      curate: async () => {
        throw new Error("Unexpected non-whitespace character after JSON");
      },
      warn: (message) => warnings.push(message),
    });
    expect(failed.failed).toBe(true);
    expect(failed.contexts.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("as if --no-history");

    const ok = await selectTaskContexts({
      curate: async () => new Map([["task-1", "context"]]),
      warn: (message) => warnings.push(message),
    });
    expect(ok.failed).toBe(false);
    expect(ok.contexts.get("task-1")).toBe("context");
    expect(warnings).toHaveLength(1);
  });

  test("resolves explicit and env history paths before Claude session lookup", () => {
    expect(
      resolveConversationHistoryFile({
        historyFile: "explicit.jsonl",
        env: { OPEN_AGENTS_HISTORY_FILE: "env.jsonl" },
      }),
    ).toContain("explicit.jsonl");
    expect(
      resolveConversationHistoryFile({
        env: { OPEN_AGENTS_HISTORY_FILE: "env.jsonl" },
      }),
    ).toContain("env.jsonl");
  });

  test("finds Claude Code transcript by session id", () => {
    const home = mkdtempSync(join(tmpdir(), "compact-history-"));
    try {
      const sessionId = "fe080f49-6b6b-4f57-98ab-c954671c6a40";
      const projectDir = join(
        home,
        ".claude",
        "projects",
        "C--Users-dpwra-dev-davstack",
      );
      mkdirSync(projectDir, { recursive: true });
      const transcript = join(projectDir, `${sessionId}.jsonl`);
      writeFileSync(transcript, "{}\n");

      expect(findClaudeTranscriptBySession(sessionId, home)).toBe(transcript);
      expect(
        resolveConversationHistoryFile({
          env: { CLAUDE_CODE_SESSION_ID: sessionId },
          homeDir: home,
        }),
      ).toBe(transcript);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("finds Codex transcript by thread id", () => {
    const home = mkdtempSync(join(tmpdir(), "compact-codex-history-"));
    try {
      const threadId = "019eabb5-b1ba-7ba1-b84b-97efcca16393";
      const sessionDir = join(home, ".codex", "sessions", "2026", "06", "09");
      mkdirSync(sessionDir, { recursive: true });
      const transcript = join(
        sessionDir,
        `rollout-2026-06-09T10-27-52-${threadId}.jsonl`,
      );
      writeFileSync(transcript, "{}\n");

      expect(findCodexTranscriptBySession(threadId, home)).toBe(transcript);
      expect(
        resolveConversationHistoryFile({
          env: { CODEX_THREAD_ID: threadId },
          homeDir: home,
        }),
      ).toBe(transcript);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("does not guess a newest Codex history when no active session id is present", () => {
    const home = mkdtempSync(join(tmpdir(), "compact-codex-history-"));
    try {
      const codexDir = join(home, ".codex");
      mkdirSync(codexDir, { recursive: true });
      const history = join(codexDir, "history.jsonl");
      writeFileSync(history, '{"text":"hello"}\n');

      expect(
        resolveConversationHistoryFile({ env: {}, homeDir: home }),
      ).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
