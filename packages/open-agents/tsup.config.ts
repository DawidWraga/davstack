import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		explore: "src/entrypoints/explore.ts",
		"fast-edit": "src/entrypoints/fast-edit.ts",
		"core/jobs": "src/core/jobs.ts",
		"core/parse": "src/core/parse.ts",
		"core/paths": "src/core/paths.ts",
		"core/deliverable": "src/core/deliverable.ts",
		"adapters/types": "src/adapters/types.ts",
		"adapters/cursor": "src/adapters/cursor.ts",
		"adapters/gemini": "src/adapters/gemini.ts",
	},
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	dts: {
		entry: {
			"core/jobs": "src/core/jobs.ts",
			"core/parse": "src/core/parse.ts",
			"core/paths": "src/core/paths.ts",
			"core/deliverable": "src/core/deliverable.ts",
			"adapters/types": "src/adapters/types.ts",
			"adapters/cursor": "src/adapters/cursor.ts",
			"adapters/gemini": "src/adapters/gemini.ts",
		},
		compilerOptions: {
			module: "ESNext",
			moduleResolution: "Bundler",
			target: "ES2022",
			types: ["node"],
			strict: true,
			esModuleInterop: true,
			skipLibCheck: true,
			isolatedModules: true,
			resolveJsonModule: true,
		},
	},
	clean: true,
	splitting: false,
	sourcemap: true,
})
