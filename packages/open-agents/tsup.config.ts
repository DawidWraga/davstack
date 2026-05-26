import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		explore: "src/entrypoints/explore.ts",
		"fast-edit": "src/entrypoints/fast-edit.ts",
	},
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	dts: false,
	clean: true,
	splitting: false,
	sourcemap: true,
})
