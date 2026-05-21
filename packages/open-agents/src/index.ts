// open-agents — programmatic library exports. The shared, non-skill core:
// a generic self-waiting subagent run loop split along two orthogonal axes,
// profile (what the subagent is) × adapter (which CLI runs it).

export { runJob, resultFilePath, DEFAULT_TIMEOUT_SEC } from './core/run.ts';
export {
  extractDeliverable,
  renderJobResult,
  readDeliverable,
} from './core/deliverable.ts';
export {
  createJob,
  readJob,
  updateJob,
  listJobs,
  cancelJob,
  mostRecentFinishedJob,
  findRunningJobs,
  pruneOlderThanDays,
} from './core/jobs.ts';
export { dataHome, jobsDir, logsDir, repoHash, ensureDir } from './core/paths.ts';
export { parseLine, summariseEvents, extractChatId, walkToolUses } from './core/parse.ts';

export type { Profile, ProfileMode } from './profiles/types.ts';
export { SENTINEL } from './profiles/types.ts';
export { exploreProfile } from './profiles/explore.ts';
export { editProfile } from './profiles/edit.ts';

export type { AgentAdapter, Tier, BuildArgsInput, RunSummary } from './adapters/types.ts';
export {
  cursorAdapter,
  resolveBin,
  resolveCursorAgentNode,
  sweepDotTest,
} from './adapters/cursor.ts';
export {
  agyAdapter,
  brainBaseDir,
  continueUntilComplete,
  extractFromBrainTranscript,
  makeContinueRunner,
  resetBrainSnapshot,
  resolveAgyExe,
  snapshotBrainDirs,
  summariseAgy,
  sweepLitterDir,
  TRUNCATION_RE,
} from './adapters/agy.ts';

export { main, bindProfile } from './cli.ts';
