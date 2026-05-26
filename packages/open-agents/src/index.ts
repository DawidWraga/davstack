// open-agents — programmatic library exports. The shared, non-skill core:
// a generic self-waiting subagent run loop split along two orthogonal axes,
// profile (what the subagent is) × adapter (which CLI runs it).

export { runJob, resultFilePath, DEFAULT_TIMEOUT_SEC } from './core/run.js';
export {
  extractDeliverable,
  renderJobResult,
  readDeliverable,
} from './core/deliverable.js';
export {
  createJob,
  readJob,
  updateJob,
  listJobs,
  cancelJob,
  mostRecentFinishedJob,
  findRunningJobs,
  pruneOlderThanDays,
} from './core/jobs.js';
export { dataHome, jobsDir, logsDir, repoHash, ensureDir } from './core/paths.js';
export { parseLine, summariseEvents, extractChatId, walkToolUses } from './core/parse.js';

export type { Profile, ProfileMode } from './profiles/types.js';
export { SENTINEL } from './profiles/types.js';
export { exploreProfile } from './profiles/explore.js';
export { editProfile } from './profiles/edit.js';

export type { AgentAdapter, Tier, BuildArgsInput, RunSummary } from './adapters/types.js';
export {
  cursorAdapter,
  resolveBin,
  resolveCursorAgentNode,
  sweepDotTest,
} from './adapters/cursor.js';
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
} from './adapters/agy.js';

export { main, bindProfile } from './cli.js';
