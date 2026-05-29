// log-server — local Sentry log-ingest endpoint.
// (Historic CLI names: `diag`, then `log-sink`. Env var prefixes stay
// DIAG_* for back-compat with existing user/repo setups.)
//
// Verbs:
//   serve         boot the ingest endpoint
//   refresh       evict cached DB handles + re-read config; keep PID
//   health        liveness check
//   doctor        validate local install (node, config, db rows, daemon liveness)
//                 (formerly `check`; `check` retained as a deprecated alias)
//
// Reading the log store: use sqlite3 directly against `.davstack/logs/<db>`.
// The flat `attrs` column is populated at insert time so probe attributes
// are one `json_extract` away. Recipes live in
// packages/logs-server/docs/reading-logs.md.
//
// Retention is file-based: each session writes its own `.davstack/logs/<name>.db`,
// so cleanup is `mv` into an archive dir. See docs/reading-logs.md#sessions.
//
// The CLI spec lives in ./cli-spec.ts (side-effect-free) so it can be
// imported by the skill CLI-reference generator without executing the CLI.

import { defineCli } from '@davstack/cli-utils';
import { cliSpec } from './cli-spec.js';

const cli = defineCli(cliSpec);

const code = await cli.run(process.argv.slice(2));
process.exit(code);
