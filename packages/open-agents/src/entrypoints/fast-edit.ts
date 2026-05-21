#!/usr/bin/env bun
// fast-edit entrypoint — binds the edit profile, then dispatches the cli
// verbs. The profile is forced, so `submit` is an edit job (the old --edit
// semantics are now implicit in this entrypoint).

import { bindProfile, main } from '../cli.ts';
import { editProfile } from '../profiles/edit.ts';

bindProfile(editProfile);
main().catch((err: any) => {
  process.stderr.write(`cursor-jobs: ${err?.stack || err}\n`);
  process.exit(1);
});
