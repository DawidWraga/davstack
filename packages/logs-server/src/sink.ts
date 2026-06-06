// Programmatic embedding surface for the sink. Use this to write Sentry-shaped
// telemetry into a sink SQLite file IN-PROCESS — no HTTP daemon, no network.
// A `bun build --compile` standalone binary can open the sink DB with `openDb`
// and feed serialized Sentry envelopes straight to `handleIngest` from a custom
// transport. This module is a side-effect-free re-export of the existing ingest
// primitives (CLI/daemon/server logic is untouched); importing it opens nothing
// and starts nothing.

export { openDb, insertLogs, selectByTrace, type LogRow } from './db.js';
export { handleIngest, dispatchIngest, type IngestResult } from './ingest.js';
export { parseEnvelope, type ParsedLog } from './envelope.js';
export { decodeBody } from './decode.js';
