import { defineWorkspace } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Dedupe vitest across the workspace: peer-deps in some packages pull a
// newer vitest into the package's own node_modules; without aliasing, the
// in-test `import 'vitest'` resolves to that copy while the runner is the
// root copy, producing "Vitest failed to find the current suite".
const vitestAlias = path.join(here, 'node_modules/vitest');

export default defineWorkspace([
	{
		resolve: { alias: { vitest: vitestAlias } },
		test: {
			name: 'cli-utils',
			root: './packages/cli-utils',
			environment: 'node',
			include: ['__tests__/**/*.test.ts'],
		},
	},
	{
		resolve: { alias: { vitest: vitestAlias } },
		test: {
			name: 'logs-server',
			root: './packages/logs-server',
			environment: 'node',
			include: ['__tests__/**/*.test.ts'],
			exclude: ['__tests__/bun-only/**', '**/node_modules/**'],
		},
	},
	{
		resolve: { alias: { vitest: vitestAlias } },
		test: {
			name: 'vitest-server',
			root: './packages/vitest-server',
			environment: 'node',
			include: ['__tests__/**/*.test.ts'],
			exclude: ['__tests__/bun-only/**', '**/node_modules/**'],
		},
	},
	{
		resolve: { alias: { vitest: vitestAlias } },
		test: {
			name: 'playwright-server',
			root: './packages/playwright-server',
			environment: 'node',
			include: ['__tests__/**/*.test.ts'],
			exclude: ['__tests__/bun-only/**', '**/node_modules/**'],
		},
	},
	{
		resolve: { alias: { vitest: vitestAlias } },
		test: {
			name: 'open-agents',
			root: './packages/open-agents',
			environment: 'node',
			include: ['__tests__/**/*.test.ts'],
			exclude: ['__tests__/bun-only/**', '**/node_modules/**'],
		},
	},
	{
		resolve: { alias: { vitest: vitestAlias } },
		test: {
			name: 'tui',
			root: './packages/tui',
			environment: 'node',
			include: ['src/**/*.test.{ts,tsx}'],
			exclude: ['**/node_modules/**'],
		},
	},
]);
