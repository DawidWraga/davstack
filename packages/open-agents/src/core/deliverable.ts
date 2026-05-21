// Deliverable extraction + the compact index renderer. Adapter/profile-
// agnostic: the SENTINEL slice is a pure text op; the only adapter touch is
// the log-reconstruction fallback in readDeliverable (parse + summarise),
// which is passed in.

import { existsSync, readFileSync } from 'node:fs';
import type { AgentAdapter } from '../adapters/types.ts';
import { SENTINEL } from '../profiles/types.ts';

// The marker is a whole-line match — not a substring. A preamble mention
// ("I'll end with ___FINAL_OUTPUT___") is not an exact line so it's skipped;
// quoted source containing the token mid-line cannot mis-slice.
//
// It works as a SEPARATOR *or* a TERMINATOR: models reliably emit either
//   <preamble>\n___FINAL_OUTPUT___\n<deliverable>            (separator), or
//   <deliverable>\n___FINAL_OUTPUT___                         (terminator),
// the latter being a fair reading of "emit that marker as the final marker;
// output nothing after the deliverable". Slicing only *after* the last marker
// silently dropped the entire deliverable in the terminator case (job still
// reported done) — so when nothing follows the last marker we take the text
// before it (between the prior marker, if any, and this one). A non-empty
// summary can no longer yield an empty deliverable.
export function extractDeliverable(text: string | undefined): string {
  if (!text) return '(no final message captured)';
  const lines = text.split('\n');
  const markers: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === SENTINEL) markers.push(i);
  }
  if (markers.length === 0) return text.trim();
  const last = markers[markers.length - 1];
  const after = lines
    .slice(last + 1)
    .join('\n')
    .trim();
  if (after) return after; // separator: the deliverable follows the marker
  // terminator: marker emitted last → deliverable is before it. An earlier
  // marker, if present, was the separator; take the span between the two.
  const prev = markers.length > 1 ? markers[markers.length - 2] : -1;
  const before = lines
    .slice(prev + 1, last)
    .join('\n')
    .trim();
  return before || text.trim();
}

// Render a terminal job's COMPACT INDEX — status, a short label (NOT the spec
// echoed back), and the path to its own clean deliverable file. The
// deliverable itself is never inlined here. Returns { text, code }; no exit.
export function renderJobResult(
  readJob: (repoPath: string, id: string) => any,
  repoPath: string,
  id: string,
): { text: string; code: number } {
  const job = readJob(repoPath, id);
  if (!job) return { text: `(no job ${id})`, code: 1 };
  const elapsed =
    job.finishedAt && job.startedAt
      ? `${Math.round((+new Date(job.finishedAt) - +new Date(job.startedAt)) / 1000)}s`
      : '?';
  const SECTION = /^(goal|context|scope|output|changes|constraints|acceptance|spec)\b/i;
  const label =
    (job.prompt || '')
      .split('\n')
      .map((l: string) =>
        l
          .replace(/^[#>*\s-]+/, '')
          .replace(/<\/?[a-z_]+>/gi, '')
          .trim(),
      )
      .find((l: string) => l && !SECTION.test(l))
      ?.slice(0, 70) || '(no label)';
  const out: string[] = [];
  out.push(
    `### open-agent ${job.id} — ${job.status} (exit ${job.exitCode ?? '?'}) · ` +
      `${job.model} · ${elapsed}${job.killed ? ' · watchdog/timeout killed' : ''}`,
  );
  out.push(`label: ${label}`);
  if (job.filesChanged?.length) {
    out.push('files changed:');
    for (const f of job.filesChanged) out.push(`  - ${f}`);
  }
  out.push(
    job.resultPath && existsSync(job.resultPath)
      ? `result → ${job.resultPath}`
      : 'result → (no deliverable file — inspect with `tail`/log)',
  );
  out.push(
    job.cursorChatId
      ? `follow-up: cursor-agent --resume=${job.cursorChatId}`
      : '(no chat id captured — cannot resume)',
  );
  return { text: out.join('\n'), code: job.status === 'done' ? 0 : 1 };
}

// The clean deliverable for `result`: the job's own file, else reconstruct
// from the raw log via the adapter's parser. No header, no task echo.
export function readDeliverable(adapter: AgentAdapter, job: any): string {
  if (job.resultPath && existsSync(job.resultPath)) {
    return readFileSync(job.resultPath, 'utf8');
  }
  let finalText = job.summary;
  if (!finalText && existsSync(job.rawLogPath)) {
    const events = readFileSync(job.rawLogPath, 'utf8')
      .split('\n')
      .map((l) => adapter.parseLine(l))
      .filter(Boolean) as any[];
    finalText = adapter.summarise(events).summary;
  }
  return extractDeliverable(finalText) + '\n';
}
