import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
	},
	format: ['esm'],
	target: 'node20',
	outDir: 'dist',
	dts: true,
	clean: true,
	splitting: false,
	sourcemap: true,
});
