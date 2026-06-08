import { type Profile, assembleScaffold } from './types.js';

const GUARDS =
  '- SPEC WRITER ONLY: write a compact execution spec for a later subagent. Do not solve the task.\n' +
  '- READ-ONLY: inspect files only if the prompt explicitly asks you to use repository context.\n' +
  '- Preserve concrete user intent, the original user query, short useful quotes, constraints, file scope, project context, conversation decisions, and non-goals from the history.\n' +
  '- Distill the history. Do not copy the transcript, full history tail, or long excerpts into the generated spec.\n' +
  '- Keep the generated spec super concise and brief; point to the history file for uncertain details instead of copying them.\n' +
  '- Do not invent requirements. If important context is missing, state the ambiguity in the spec.\n' +
  '- OUTPUT: only the generated execution spec. Use <goal>, <context>, <scope>, and <constraints> tags. Do not include an <acceptance> block unless the history explicitly requires one.\n';

export const specWriterProfile: Profile = {
  name: 'spec-writer',
  tag: 'spec',
  mode: 'ask',
  buildPrompt(specBody: string, addendum?: string) {
    return assembleScaffold(specBody, GUARDS, addendum);
  },
  warnIfMissingAcceptance() {
    // The spec writer produces acceptance criteria; its own prompt does not need them.
  },
};
