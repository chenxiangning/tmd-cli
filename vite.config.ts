import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  /* 意图画布编辑器 lazy import excalidraw:不进预构建清单时,dev 首次打开会在
     点击「新建/打开」后才现场 esbuild 打包(实测 60s+),表现为长时间白屏。 */
  optimizeDeps: {
    include: ["@excalidraw/excalidraw"],
  },
  resolve: {
    alias: {
      "@kernel": fileURLToPath(new URL("./src/kernel", import.meta.url)),
      "@shell": fileURLToPath(new URL("./src/app-shell", import.meta.url)),
      "@plugins": fileURLToPath(new URL("./src/plugins", import.meta.url)),
    },
    extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
  },
  server: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
