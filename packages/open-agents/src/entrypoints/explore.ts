#!/usr/bin/env bun
// explore entrypoint — binds the explore profile, then dispatches the cli verbs.
// The profile is forced, so `submit` is explore regardless of flags (no --edit).

import { bindProfile, main } from '../cli.ts';
import { exploreProfile } from '../profiles/explore.ts';

bindProfile(exploreProfile);
main().catch((err: any) => {
  process.stderr.write(`open-agents: ${err?.stack || err}\n`);
  process.exit(1);
});
