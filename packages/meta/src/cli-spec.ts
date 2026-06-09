import type { CliSpec } from '@davstack/cli-utils';
import type { MetaFilePathMode, MetaOutputPresetName, ScanOptions } from './index.js';

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
} as const;

function resolveCliScanOptions(flags: Record<string, unknown>): ScanOptions {
  const human = flags.human === true;
  const agent = flags.agent === true;
  if (human && agent) throw new Error('Use only one output preset: --human or --agent');

  const preset: MetaOutputPresetName | undefined = agent ? 'agent' : human ? 'human' : undefined;
  const filePaths = flags.file_paths;
  if (filePaths !== undefined && filePaths !== 'concise' && filePaths !== 'full') {
    throw new Error('--file_paths must be "concise" or "full"');
  }

  return {
    deep: flags.deep as boolean,
    preset,
    indent: flags.indent as boolean | undefined,
    filePaths: filePaths as MetaFilePathMode | undefined,
  };
}

export const cliSpec: CliSpec = {
  name: 'davstack-meta',
  description: 'Generate and view concise folder metadata for agents.',
  commands: {
    gen: {
      description: 'Write .folder-meta.generated.md in a folder',
      positionals: [{ name: 'path', required: true, description: 'Folder to scan' }],
      flags: {
        deep: {
          type: 'boolean',
          default: false,
          description: 'Recursively include child folders',
        },
        ...outputFlags,
      },
      run: async (ctx) => {
        const { generateFolderMetadata } = await import('./index.js');
        const result = await generateFolderMetadata(ctx.positionals[0], resolveCliScanOptions(ctx.flags));
        console.log(result.path);
      },
    },
    view: {
      description: 'Print existing metadata, generating it when missing',
      positionals: [{ name: 'path', required: true, description: 'Folder to view' }],
      flags: {
        deep: {
          type: 'boolean',
          default: false,
          description: 'Recursively include child folders',
        },
        ...outputFlags,
      },
      run: async (ctx) => {
        const { viewFolderMetadata } = await import('./index.js');
        console.log(await viewFolderMetadata(ctx.positionals[0], resolveCliScanOptions(ctx.flags)));
      },
    },
  },
};
