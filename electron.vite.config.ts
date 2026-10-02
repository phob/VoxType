import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// electron-vite 5 supports Vite 5-7. Under Vite 8 it no longer externalizes Electron (the bundled npm
// "electron" stub only returns the executable path, so `app` is undefined) and no longer names the ESM
// preload .mjs, which Electron needs to load it as a module. Both are set explicitly here.
const electronExternal = ["electron", /^electron\/.+/];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
        external: electronExternal
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
