import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    install: "src/install.ts",
    render: "src/render.ts",
    runtime: "src/runtime.ts",
  },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
})
