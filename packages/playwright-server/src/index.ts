// playwright-server entry. Long-lived warm-browser host for fast e2e
// iteration; agents POST spec paths to a daemon and clicks execute against
// the live window in 1–3 s.
//
// Verbs:
//   serve          boot the daemon (this is the heavy one)
//   run <file>     execute a spec against the running daemon
//   goto <url>     navigate the live page
//   refresh        flush spec-module ESM cache; re-read config; keep PID
//   refresh-auth   mint a fresh session and reseed the live context
//   health         daemon liveness check
//   shutdown       gracefully stop the daemon
//   doctor         validate local install (formerly `check`; `check` kept as a deprecated alias)
//
// All non-serve verbs are CLI clients — they fetch() the running daemon and
// don't import chromium, so they're cold-start cheap (~50 ms).
//
// Consumer drops a `playwright-server.config.ts` in their project root
// describing baseUrl / storageStatePath / refreshAuth (see auth.ts).
//
// The CLI spec lives in ./cli-spec.ts (side-effect-free) so it can be
// imported by the skill CLI-reference generator without executing the CLI.

import { defineCli } from '@davstack/cli-utils';
import { cliSpec } from './cli-spec.js';

const cli = defineCli(cliSpec);

const code = await cli.run(process.argv.slice(2));
process.exit(code);
