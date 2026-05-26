// edit profile — one-pass typecheck-only mutator. Mode `force`,
// acceptance-warn. Was the `guardEdit` branch of buildPrompt(body, edit=true)
// plus the missing-<acceptance> warning in cmdSubmit.

import { type Profile, assembleScaffold } from './types.js';

const GUARDS =
  '- VERIFY: typecheck only (tsc --noEmit / project equiv) on changed files. NEVER run or write ' +
  'tests.\n' +
  '- ONE PASS: if it will not apply cleanly or typecheck first try, STOP — report what you tried, ' +
  'the exact error, why; that is the handback. Do not iterate or widen scope.\n';

const ACCEPTANCE_RE = /(^\s*ACCEPTANCE\s*:)|<acceptance>/im;

export const editProfile: Profile = {
  name: 'edit',
  tag: 'EDIT',
  mode: 'force',
  buildPrompt(specBody: string, addendum?: string) {
    return assembleScaffold(specBody, GUARDS, addendum);
  },
  warnIfMissingAcceptance(specBody: string) {
    if (!ACCEPTANCE_RE.test(specBody)) {
      process.stderr.write(
        'open-agents: warning — an --edit spec has no <acceptance> (the gate you run after).\n',
      );
    }
  },
};
