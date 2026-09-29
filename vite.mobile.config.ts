/**
 * 手机壳专用构建(vite build -c vite.mobile.config.ts → dist-mobile)。
 * 与 vite.config.ts 的差异仅三处:入口 mobile-index.html(无条件 mobile 树)、
 * 出目录 dist-mobile、不产 sourcemap;插件/别名/目标与主配置逐项一致
 * (mobile 组件也用 Tailwind 原子类,尾巴扫 src/mobile 同样需要)。
 * 消费方:release.yml android/ios job(package.json build:mobile)。
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@kernel": fileURLToPath(new URL("./src/kernel", import.meta.url)),
      "@shell": fileURLToPath(new URL("./src/app-shell", import.meta.url)),
      "@plugins": fileURLToPath(new URL("./src/plugins", import.meta.url)),
    },
    extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
  },
  build: {
    target: "es2022",
    outDir: "dist-mobile",
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./mobile-index.html", import.meta.url)),
    },
  },
});
