import tailwindPlugin from "bun-plugin-tailwind"
import { defineConfig } from "bunup"

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "browser",
  sourcemap: true,
  dts: true,
  external: ["react", "react-dom"],
  plugins: [tailwindPlugin],
  css: {
    inject: true,
  },
})
