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
import { ensureDir, jobsDir, logsDir } from './paths.ts';

/**
 * @typedef {'running'|'done'|'failed'|'cancelled'} JobStatus
 */

/**
 * @typedef {Object} JobRecord
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model
 * @property {string=} cursorChatId
 * @property {number=} pid
 * @property {JobStatus} status
 * @property {number=} exitCode
 * @property {string} startedAt
 * @property {string=} finishedAt
 * @property {string} rawLogPath
 * @property {string=} summary
 * @property {string[]=} filesChanged
 * @property {boolean=} background
 * @property {boolean=} cloud
 */

/**
 * @typedef {Object} CreateJobInit
 * @property {string} id
 * @property {string} repoPath
 * @property {string} prompt
 * @property {string} model
 * @property {boolean=} background
 * @property {boolean=} cloud
 */

/**
 * @param {string} repoPath
 * @param {string} id
 */
export function jobFilePath(repoPath, id) {
  return join(jobsDir(repoPath), `${id}.json`);
}

/**
 * @param {string} repoPath
 * @param {string} id
 */
export function rawLogPath(repoPath, id) {
  return join(logsDir(repoPath), `${id}.ndjson`);
}

function atomicWrite(target, data) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, target);
}

/**
 * @param {CreateJobInit} init
 * @returns {JobRecord}
 */
export function createJob(init) {
  ensureDir(jobsDir(init.repoPath));
  ensureDir(logsDir(init.repoPath));
  /** @type {JobRecord} */
  const record = {
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

/**
 * @param {string} repoPath
 * @param {string} id
 * @returns {JobRecord|null}
 */
export function readJob(repoPath, id) {
  const file = jobFilePath(repoPath, id);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @param {Partial<JobRecord>} patch
 * @returns {JobRecord|null}
 */
export function updateJob(repoPath, id, patch) {
  const existing = readJob(repoPath, id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  atomicWrite(jobFilePath(repoPath, id), JSON.stringify(merged, null, 2));
  return merged;
}

/**
 * @typedef {Object} ListOpts
 * @property {number=} limit
 * @property {JobStatus=} status
 */

/**
 * @param {string} repoPath
 * @param {ListOpts} [opts]
 * @returns {JobRecord[]}
 */
export function listJobs(repoPath, opts = {}) {
  const dir = jobsDir(repoPath);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
  /** @type {JobRecord[]} */
  const records = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string')
        records.push(parsed);
    } catch {
      continue;
    }
  }
  records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const filtered = opts.status ? records.filter((r) => r.status === opts.status) : records;
  return typeof opts.limit === 'number' ? filtered.slice(0, opts.limit) : filtered;
}

/**
 * @param {string} repoPath
 * @param {number} [days]
 * @returns {number}
 */
export function pruneOlderThanDays(repoPath, days = 30) {
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

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} repoPath
 * @param {string} id
 * @param {number} [graceMs]
 * @returns {Promise<JobRecord|null>}
 */
export async function cancelJob(repoPath, id, graceMs = 5_000) {
  const job = readJob(repoPath, id);
  if (!job) return null;
  if (job.status !== 'running') return job;
  if (typeof job.pid === 'number' && isProcessAlive(job.pid)) {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {
      // ignore — may have exited
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

/**
 * @param {string} repoPath
 * @returns {JobRecord[]}
 */
export function findRunningJobs(repoPath) {
  return listJobs(repoPath).filter((j) => j.status === 'running');
}

/**
 * @param {string} repoPath
 * @returns {JobRecord|null}
 */
export function mostRecentFinishedJob(repoPath) {
  const jobs = listJobs(repoPath).filter((j) => j.status !== 'running');
  return jobs[0] ?? null;
}
