import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
	// you can use a list of glob patterns to define your workspaces
	// Vitest expects a list of config files
	// or directories where there is a config file
	// 'packages/*',
	// 'tests/*/vitest.config.{e2e,unit}.ts',
	// // you can even run the same tests,
	// // but with different configs in the same "vitest" process
	{
		test: {
			name: 'store',
			root: './packages/store',
			environment: 'jsdom',
			setupFiles: ['./test-setup.ts'],

			// setupFiles: ['./setup.happy-dom.ts'],
		},
	},
	{
		test: {
			name: 'service',
			root: './packages/service',
			environment: 'node',
			typecheck: {
				enabled: true,
				include: ['**/*.test.ts'],
			},
			// setupFiles: ['./test-setup.ts'],

			// setupFiles: ['./setup.happy-dom.ts'],
		},
	},
	{
		test: {
			name: 'action',
			root: './packages/action',
			environment: 'node',
			// typecheck: {
			// 	enabled: true,
			// 	include: ['**/*.test.ts'],
			// },
			// setupFiles: ['./test-setup.ts'],

			// setupFiles: ['./setup.happy-dom.ts'],
		},
	},
	{
		test: {
			name: 't3-app',
			root: './examples/t3-with-davstack',
			environment: 'node',
			typecheck: {
				enabled: true,
				include: ['**/*.test.ts'],
			},
			// setupFiles: ['./test-setup.ts'],

			// setupFiles: ['./setup.happy-dom.ts'],
		},
	},
	{
		test: {
			name: 'sound',
			root: './packages/sound',
			environment: 'jsdom',
			typecheck: {
				enabled: false,
				include: ['**/*.test.ts'],
			},
			// setupFiles: ['./test-setup.ts'],

			// setupFiles: ['./setup.happy-dom.ts'],
		},
	},
	// {
	// 	test: {
	// 		name: 'node',
	// 		root: './shared_tests',
	// 		environment: 'node',
	// 		setupFiles: ['./setup.node.ts'],
	// 	},
	// },
]);
