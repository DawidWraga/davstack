// A *profile* is "what the subagent is" — the prompt scaffold, the abstract
// run mode, and any spec-shape warnings. It is adapter-agnostic: it produces
// the full prompt string and a mode; the adapter decides how that mode maps to
// CLI flags. Was the `edit` boolean + guardRO/guardExtract/guardEdit in the
// old monolith.

// Abstract mode: 'ask' = read-only (no mutation allowed); 'force' = the
// subagent may write. Adapters map this onto their own flags.
export type ProfileMode = 'ask' | 'force';

export interface Profile {
  /** Stable profile name ("explore" | "edit"). */
  name: string;
  /** Short tag used in stderr progress + `ls` listings. */
  tag: string;
  /** Abstract execution mode the adapter translates to CLI flags. */
  mode: ProfileMode;
  /**
   * Build the full subagent prompt from the raw spec body. `addendum` is
   * optional extra guard line(s) the adapter contributes (provider/tier
   * specific — e.g. a line-number-verify directive for gemini flash explore).
   * Empty/omitted ⇒ byte-identical to the no-addendum scaffold.
   */
  buildPrompt(specBody: string, addendum?: string): string;
  /**
   * Emit a stderr warning if the spec body is missing something this profile
   * cares about (e.g. an edit spec with no <acceptance>). No-op otherwise.
   */
  warnIfMissingAcceptance(specBody: string): void;
}

// Shared scaffold head/tail so explore.ts and edit.ts only own their guard text.
export const SENTINEL = '___FINAL_OUTPUT___';

const SCAFFOLD_HEAD =
  'You are a fast execution subagent. Follow the spec (in the spec tag below) ' +
  'literally and minimally.\n' +
  'Rules:\n' +
  '- Do ONLY what the spec asks. Do not refactor, reformat, or touch anything outside its stated ' +
  'scope.\n' +
  '- If the spec is ambiguous, take the smallest reasonable action and note the ambiguity in the ' +
  'result — do not widen scope to be safe.\n' +
  '- Be terse. No preamble, no narration of your process.\n' +
  '- With large files/logs: grep or search to the relevant lines and read only ' +
  'those; never read a huge file wholesale — protect your context window.\n';

export function assembleScaffold(specBody: string, guards: string, addendum = ''): string {
  return (
    SCAFFOLD_HEAD +
    guards +
    addendum +
    '\n<spec>\n' +
    specBody.trim() +
    '\n</spec>\n\n' +
    `When finished, output a line that is EXACTLY this and nothing else on that line:\n${SENTINEL}\n` +
    'then ONLY the requested deliverable, in exactly the requested format. ' +
    'Emit that marker line once, as the final marker; output nothing after the deliverable.'
  );
}
