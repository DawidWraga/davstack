import type { CliSpec } from '@davstack/cli-utils';

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
      },
      run: async (ctx) => {
        const { generateFolderMetadata } = await import('./index.js');
        const result = await generateFolderMetadata(ctx.positionals[0], {
          deep: ctx.flags.deep as boolean,
        });
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
      },
      run: async (ctx) => {
        const { viewFolderMetadata } = await import('./index.js');
        console.log(
          await viewFolderMetadata(ctx.positionals[0], {
            deep: ctx.flags.deep as boolean,
          }),
        );
      },
    },
  },
};
