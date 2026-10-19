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
      "@excalidraw/excalidraw",
      "@uiw/react-codemirror",
      "@codemirror/language",
      "@codemirror/view",
      /* 编辑器基础键位/查找/底座(FileCodeEditorImpl.loadBaseExts 与
         editorBlame/editorDiffGutter 的纯动态 import,扫描器不可见):
         不钉则 dev 首开代码文件时现场优化+强制 reload;dev 会话中预构建
         缓存被清(如 pnpm install)会 504 Outdated Optimize Dep,编辑器
         chunk 永挂 → 文件 tab 白屏(2026-10-14 anim 文件名打开白屏实证)。 */
      "@codemirror/state",
      "@codemirror/commands",
      "@codemirror/search",
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
    rollupOptions: {
      input: {
        /* rollupOptions.input 一旦显式给出即整体替换默认入口(v0.4.0 曾因只配
           bench 让 dist 丢掉 index.html,打包产物白屏 asset not found),
           主入口必须显式占一行 */
        index: "index.html",
        /* 基准页独立入口:不进主包 chunk,产物 dist/bench/index.html 单独可达 */
        bench: "bench/index.html",
      },
    },
  },
});
