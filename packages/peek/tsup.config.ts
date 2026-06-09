import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "cli-spec": "src/cli-spec.ts",
  },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
})
