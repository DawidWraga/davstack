import { defineConfig } from "tsup"
import { copyFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		config: "src/config.ts",
		"spec-runner": "src/spec-runner.ts",
	},
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	dts: true,
	clean: true,
	splitting: false,
	sourcemap: true,
	// The loader hook is plain ESM and must remain unbundled — Node loads
	// it in a separate worker thread via module.register(), so it can't
	// share state with the bundled main module.
	onSuccess: async () => {
		const src = resolve("src/spec-loader.mjs")
		const dst = resolve("dist/spec-loader.mjs")
		if (existsSync(src)) copyFileSync(src, dst)
	},
})
