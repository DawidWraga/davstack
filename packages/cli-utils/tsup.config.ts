import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		cli: "src/cli.ts",
		"cli-help": "src/cli-help.ts",
		config: "src/config.ts",
	},
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	// dts disabled: src has pre-existing type errors (narrowing misses,
	// missing @types/node, dynamic .ts extension imports). Fix in a follow-up;
	// runtime boot is the priority for this change.
	dts: false,
	clean: true,
	splitting: false,
	sourcemap: true,
})
