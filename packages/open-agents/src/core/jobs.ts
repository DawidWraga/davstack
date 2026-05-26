// Job-record store: create/read/update/list per-repo job records on disk
// (paths resolved by ./paths.ts).

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ensureDir, jobsDir, logsDir } from './paths.js';

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  repoPath: string;
  prompt: string;
  model: string;
  status: JobStatus;
  startedAt: string;
  rawLogPath: string;
  cursorChatId?: string;
  pid?: number;
  exitCode?: number;
  finishedAt?: string;
  summary?: string;
  filesChanged?: string[];
  background?: boolean;
  cloud?: boolean;
  // Populated after createJob() by cmdSubmit / runJob.
  fullPrompt?: string;
  edit?: boolean;
  timeoutSec?: number;
  resultPath?: string;
  killed?: boolean;
}

export interface CreateJobInit {
  id: string;
  repoPath: string;
  prompt: string;
  model: string;
  background?: boolean;
  cloud?: boolean;
}

export interface ListOpts {
  limit?: number;
  status?: JobStatus;
}

export function jobFilePath(repoPath: string, id: string): string {
  return join(jobsDir(repoPath), `${id}.json`);
}

export function rawLogPath(repoPath: string, id: string): string {
  return join(logsDir(repoPath), `${id}.ndjson`);
}

function atomicWrite(target: string, data: string): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, target);
}

export function createJob(init: CreateJobInit): JobRecord {
  ensureDir(jobsDir(init.repoPath));
  ensureDir(logsDir(init.repoPath));
  const record: JobRecord = {
    id: init.id,
    repoPath: init.repoPath,
    prompt: init.prompt,
    model: init.model,
    status: 'running',
    startedAt: new Date().toISOString(),
    rawLogPath: rawLogPath(init.repoPath, init.id),
    ...(init.background ? { background: true } : {}),
    ...(init.cloud ? { cloud: true } : {}),
  };
  atomicWrite(jobFilePath(init.repoPath, init.id), JSON.stringify(record, null, 2));
  return record;
}

export function readJob(repoPath: string, id: string): JobRecord | null {
  const file = jobFilePath(repoPath, id);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
      return parsed as JobRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function updateJob(
  repoPath: string,
  id: string,
  patch: Partial<JobRecord>,
): JobRecord | null {
  const existing = readJob(repoPath, id);
  if (!existing) return null;
  const merged: JobRecord = { ...existing, ...patch };
  atomicWrite(jobFilePath(repoPath, id), JSON.stringify(merged, null, 2));
  return merged;
}

export function listJobs(repoPath: string, opts: ListOpts = {}): JobRecord[] {
  const dir = jobsDir(repoPath);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
  const records: JobRecord[] = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
        records.push(parsed as JobRecord);
      }
    } catch {
      continue;
    }
  }
  records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const filtered = opts.status ? records.filter((r) => r.status === opts.status) : records;
  return typeof opts.limit === 'number' ? filtered.slice(0, opts.limit) : filtered;
}

export function pruneOlderThanDays(repoPath: string, days = 30): number {
  const dir = jobsDir(repoPath);
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      const st = statSync(p);
      if (st.isFile() && st.mtimeMs < cutoff) {
        unlinkSync(p);
        removed += 1;
      }
    } catch {
      continue;
    }
  }
  const lDir = logsDir(repoPath);
  if (existsSync(lDir)) {
    for (const f of readdirSync(lDir)) {
      const p = join(lDir, f);
      try {
        const st = statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) unlinkSync(p);
      } catch {
        continue;
      }
    }
  }
  return removed;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function cancelJob(
  repoPath: string,
  id: string,
  graceMs = 5_000,
): Promise<JobRecord | null> {
  const job = readJob(repoPath, id);
  if (!job) return null;
  if (job.status !== 'running') return job;
  if (typeof job.pid === 'number' && isProcessAlive(job.pid)) {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {
      // may have exited
    }
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && isProcessAlive(job.pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (isProcessAlive(job.pid)) {
      try {
        process.kill(job.pid, 'SIGKILL');
      } catch {
        // ignore
      }
    }
  }
  return updateJob(repoPath, id, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  });
}

export function findRunningJobs(repoPath: string): JobRecord[] {
  return listJobs(repoPath).filter((j) => j.status === 'running');
}

export function mostRecentFinishedJob(repoPath: string): JobRecord | null {
  const jobs = listJobs(repoPath).filter((j) => j.status !== 'running');
  return jobs[0] ?? null;
}
