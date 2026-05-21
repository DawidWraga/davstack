// explore profile — read-only quote-extractor. Mode `ask`. Was the
// `guardRO`/`guardExtract` branch of the old buildPrompt(body, edit=false).

import { type Profile, assembleScaffold } from './types.ts';

const GUARDS =
  '- READ-ONLY: do not create, modify, or delete any file, and do not run mutating commands. ' +
  'If an edit seems needed, DESCRIBE it under the result instead of doing it.\n' +
  '- QUOTE-EXTRACTOR, not analyst: facts only, no conclusion/headline.\n' +
  '- OUTPUT (unless SPEC overrides it): per finding a `path:Lstart-Lend` line + fenced verbatim ' +
  'source, grouped by SCOPE question, no prose between. Hypotheses: one final ' +
  '"HYPOTHESIS (unverified):" line.\n';

export const exploreProfile: Profile = {
  name: 'explore',
  tag: 'explore',
  mode: 'ask',
  buildPrompt(specBody: string, addendum?: string) {
    return assembleScaffold(specBody, GUARDS, addendum);
  },
  warnIfMissingAcceptance() {
    // explore specs have no acceptance gate — nothing to warn about.
  },
};
