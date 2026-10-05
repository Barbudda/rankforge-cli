import { defineConfig } from "tsup";

// One self-contained ESM file, zero runtime dependencies.
export default defineConfig({
  entry: { index: "cli/src/index.ts" },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node18",
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".js" }),
});
