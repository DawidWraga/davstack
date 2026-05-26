import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		config: "src/config.ts",
	},
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	// dts disabled: cli-utils source has pre-existing type errors that
	// cascade into dependents. Fix in a follow-up.
	dts: false,
	clean: true,
	splitting: false,
	sourcemap: true,
})
