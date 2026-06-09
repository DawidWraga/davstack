import type { CliSpec } from '@davstack/cli-utils';
import type { PeekFilePathMode, PeekOutputPresetName, ScanOptions } from './index.js';

const outputFlags = {
  human: {
    type: 'boolean',
    default: false,
    description: 'Use human-readable output defaults: indented XML and full repo-relative file paths',
  },
  agent: {
    type: 'boolean',
    default: false,
    description: 'Use token-optimized output defaults: no indentation and concise file paths',
  },
  indent: {
    type: 'boolean',
    description: 'Indent nested folder output',
  },
  file_paths: {
    type: 'string',
    description: 'File path style: concise or full',
  },
  'include-lines-count': {
    type: 'boolean',
    description: 'Include total line counts on file tags',
  },
} as const;

function resolveCliScanOptions(flags: Record<string, unknown>): ScanOptions {
  const human = flags.human === true;
  const agent = flags.agent === true;
  if (human && agent) throw new Error('Use only one output preset: --human or --agent');

  const preset: PeekOutputPresetName | undefined = agent ? 'agent' : human ? 'human' : undefined;
  const filePaths = flags.file_paths;
  if (filePaths !== undefined && filePaths !== 'concise' && filePaths !== 'full') {
    throw new Error('--file_paths must be "concise" or "full"');
  }

  return {
    deep: flags.deep as boolean,
    preset,
    indent: flags.indent as boolean | undefined,
    filePaths: filePaths as PeekFilePathMode | undefined,
    includeLinesCount: flags['include-lines-count'] as boolean | undefined,
  };
}

export const cliSpec: CliSpec = {
  name: 'peek',
  description: 'Print concise folder summaries for agents.',
  positionals: [{ name: 'path', required: true, description: 'Folder to peek at' }],
  flags: {
    deep: {
      type: 'boolean',
      description: 'Recursively include child folders',
    },
    ...outputFlags,
  },
  run: async (ctx) => {
    const { peekFolder } = await import('./index.js');
    console.log(await peekFolder(ctx.positionals[0], resolveCliScanOptions(ctx.flags)));
  },
};
