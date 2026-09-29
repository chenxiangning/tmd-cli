import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  /* 重库 lazy import 的依赖钉进启动期预打包:vite 扫描器看不见纯动态 import,
     未入清单时 dev 首次触达才现场优化并强制整页 reload;长 dev 会话跨
     pnpm-lock 变化重优化时,半截缓存(旧 lang chunk 指向已重建的 dist-*.js)
     会撕裂模块图 → tags is not iterable 渲染崩 → files 插件熔断、文件树入口
     消失,HTML/代码文件首开必白屏(2026-09-29 实证)。excalidraw 同症状先例。 */
  optimizeDeps: {
    include: [
      "@uiw/react-codemirror",
      "@codemirror/language",
      "@codemirror/view",
      "@lezer/highlight",
      "@codemirror/lang-javascript",
      "@codemirror/lang-json",
      "@codemirror/lang-html",
      "@codemirror/lang-css",
      "@codemirror/lang-markdown",
      "@codemirror/lang-python",
      "@codemirror/lang-rust",
      "@codemirror/lang-cpp",
      "@codemirror/lang-go",
      "@codemirror/lang-java",
      "@codemirror/lang-php",
      "@codemirror/lang-sql",
      "@codemirror/lang-xml",
      "@codemirror/lang-yaml",
      "@codemirror/legacy-modes/mode/ruby",
      "@codemirror/legacy-modes/mode/shell",
      "@codemirror/legacy-modes/mode/swift",
      "@codemirror/legacy-modes/mode/toml",
      "@codemirror/legacy-modes/mode/r",
    ],
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
