// vitest-server entry. Long-lived Vitest host for storybook/unit projects;
// warm reruns drop a story file's cycle from ~50s cold to ~3-15s.
//
// Verbs:
//   serve            boot the daemon (heavy — vite + playwright + storybook addon)
//   run <file>       rerun a file against the running daemon
//   refresh          flush vitest's transform cache + vite-node module cache; re-read config; keep PID
//   health           liveness check
//   shutdown         stop the daemon
//   doctor           validate local install (formerly `check`; `check` kept as a deprecated alias)
//
// Runtime: recommended `node --experimental-transform-types ./index.ts
// serve` (Node 24+). Bun works on Linux/macOS but fails on Windows
// (storybook 10.3 malformed `file:/C:/…` URLs); tsx fails on the
// estree-walker resolver. See session.ts header for the full matrix.
//
// Consumer drops a `vitest-server.config.ts` in their project root:
//   export default { project: 'storybook', primeFile: 'src/.../foo.stories.tsx' }
// Or pass --project / --prime on the `serve` command.
//
// The CLI spec lives in ./cli-spec.ts (side-effect-free) so it can be
// imported by the skill CLI-reference generator without executing the CLI.

import { defineCli } from '@davstack/cli-utils';
import { cliSpec } from './cli-spec.js';

const cli = defineCli(cliSpec);

const code = await cli.run(process.argv.slice(2));
process.exit(code);
