import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false, // Skip DTS generation for now - server doesn't need it
  clean: true,
  sourcemap: true,
  target: "node20",
  splitting: false,
});

