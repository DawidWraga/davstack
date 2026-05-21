// The generic run loop: owns the subagent process — spawn → stream → watchdog
// → SENTINEL extraction → job record. Adapter- and profile-agnostic; it takes
// {adapter, profile} and only talks to their interfaces. Was runJob() in the
// monolith with cursor/edit specifics inlined.

import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter } from '../adapters/types.ts';
import type { Profile } from '../profiles/types.ts';
import { extractDeliverable } from './deliverable.ts';
import { readJob, updateJob } from './jobs.ts';
import { jobsDir } from './paths.ts';

export const DEFAULT_TIMEOUT_SEC = 1800; // explore can take ~12+ min; be generous

// Each job's clean deliverable (only text after the SENTINEL marker line) is
// written to its OWN file — no input echo, no stderr. submit only prints an
// index pointing at it.
export function resultFilePath(repoPath: string, id: string): string {
  return join(jobsDir(repoPath), `${id}.result.md`);
}

interface RunDeps {
  adapter: AgentAdapter;
  profile: Profile;
}

// Resolves (with 0) when the job reaches a terminal state. Used by the
// detached runner (`__run`) and by a blocking foreground `submit`.
export function runJob(
  { adapter, profile }: RunDeps,
  repoPath: string,
  id: string,
): Promise<number> {
  return new Promise((resolve) => {
    const job = readJob(repoPath, id);
    if (!job) return resolve(1);

    const { bin, prelaunchArgs, shell } = adapter.resolveBin();
    const args = [
      ...prelaunchArgs,
      ...adapter.buildArgs({
        model: job.model,
        mode: profile.mode,
        prompt: job.fullPrompt,
      }),
    ];
    const child = spawn(bin, args, {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell,
    });
    updateJob(repoPath, id, { pid: child.pid });

    const log = createWriteStream(job.rawLogPath, { flags: 'a' });
    const events: any[] = [];
    let buf = '';
    let sawResult = false;
    let killed = false;

    const armWatchdog = () => {
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          killed = true;
          try {
            child.kill('SIGTERM');
          } catch {
            /* already gone */
          }
          setTimeout(() => {
            try {
              if (child.exitCode === null) child.kill('SIGKILL');
            } catch {
              /* already gone */
            }
          }, 5000);
        }
      }, 5000); // cursor-agent sometimes emits `result` then fails to self-exit
    };

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        log.write(line + '\n');
        const ev = adapter.parseLine(line);
        if (!ev) continue;
        events.push(ev);
        if (ev.type === 'result' && !sawResult) {
          sawResult = true;
          armWatchdog();
        }
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (d: string) => {
      for (const l of String(d).split('\n')) if (l.trim()) log.write(`# stderr: ${l}\n`);
    });

    const hardTimeout = setTimeout(
      () => {
        killed = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
        setTimeout(() => {
          try {
            if (child.exitCode === null) child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, 5000);
      },
      (job.timeoutSec || DEFAULT_TIMEOUT_SEC) * 1000,
    );

    const finalize = (code: number | null) => {
      clearTimeout(hardTimeout);
      if (buf.trim()) {
        log.write(buf + '\n');
        const ev = adapter.parseLine(buf);
        if (ev) events.push(ev);
      }
      log.end();
      const s = adapter.summarise(events);
      const exitCode = typeof code === 'number' ? code : sawResult ? 0 : 1;
      const ok = s.success && (exitCode === 0 || sawResult);
      const resPath = resultFilePath(repoPath, id);
      try {
        writeFileSync(resPath, extractDeliverable(s.summary) + '\n', 'utf8');
      } catch {
        /* best-effort */
      }
      updateJob(repoPath, id, {
        status: ok ? 'done' : 'failed',
        exitCode,
        finishedAt: new Date().toISOString(),
        summary: s.summary,
        resultPath: resPath,
        filesChanged: s.filesChanged,
        cursorChatId: adapter.extractChatId(events),
        killed: killed || undefined,
      });
      resolve(0);
    };

    child.on('close', finalize);
    child.on('error', (err: Error) => {
      clearTimeout(hardTimeout);
      log.write(`# spawn error: ${err.message}\n`);
      log.end();
      updateJob(repoPath, id, {
        status: 'failed',
        exitCode: -1,
        finishedAt: new Date().toISOString(),
        summary: `spawn error: ${err.message}`,
      });
      resolve(0);
    });
  });
}
