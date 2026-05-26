import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		config: "src/config.ts",
	},
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	dts: false,
	clean: true,
	splitting: false,
	sourcemap: true,
	// Runtime is bun by default (db.ts uses bun:sqlite, server.ts uses Bun.serve);
	// keep these specifiers as bare imports so bun resolves them natively.
	external: ["bun:sqlite", "bun:test"],
})
