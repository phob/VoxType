import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// electron-vite 5 supports Vite 5-7. Under Vite 8 it no longer externalizes Electron (the bundled npm
// "electron" stub only returns the executable path, so `app` is undefined) and no longer names the ESM
// preload .mjs, which Electron needs to load it as a module. Both are set explicitly here.
const electronExternal = ["electron", /^electron\/.+/];
// Runtime dependencies stay in node_modules (electron-builder packs them). Bundled, the Anthropic SDK broke
// the main process: electron-vite puts its __dirname shim after the last line that looks like an import,
// and the SDK has one inside a JSDoc comment.
const mainExternal = [...electronExternal, "@anthropic-ai/sdk", /^@anthropic-ai\/sdk\/.+/];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
        external: mainExternal
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
        external: electronExternal,
        output: { format: "es", entryFileNames: "[name].mjs" }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()]
  }
});
