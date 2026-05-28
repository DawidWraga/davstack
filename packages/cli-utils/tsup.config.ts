import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		cli: "src/cli.ts",
		"cli-help": "src/cli-help.ts",
		config: "src/config.ts",
		dotenv: "src/dotenv.ts",
		restart: "src/restart.ts",
	},
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	dts: true,
	clean: true,
	splitting: false,
	sourcemap: true,
})
