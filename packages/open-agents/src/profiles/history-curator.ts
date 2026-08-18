import { type Profile, assembleScaffold } from "./types.js";

const GUARDS =
  "- HISTORY CURATOR ONLY: select task-relevant facts from the supplied conversation. Do not solve or rewrite the tasks.\n" +
  "- READ-ONLY: do not modify repository files.\n" +
  "- Keep every task isolated. Never merge their context or copy context between unrelated tasks.\n" +
  "- OUTPUT: strict JSON only, matching the schema in the supplied task. No markdown fences or commentary.\n";

export const historyCuratorProfile: Profile = {
  name: "history-curator",
  tag: "history",
  mode: "ask",
  buildPrompt(specBody: string, addendum?: string) {
    return assembleScaffold(specBody, GUARDS, addendum);
  },
  warnIfMissingAcceptance() {},
};
