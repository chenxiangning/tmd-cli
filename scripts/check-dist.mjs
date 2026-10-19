/* 构建产物入口断言:dist/index.html 缺失 = Tauri 包体启动即白屏 asset not found
   (v0.4.0 首发实证:rollupOptions.input 一旦显式给出即整体替换 vite 默认入口,
   只配 bench 时主应用完全不产出,而 build 链其余各段依旧全绿,gate 拦不住)。 */
import { existsSync } from "node:fs";

if (!existsSync("dist/index.html")) {
  console.error(
    "[check-dist] dist/index.html 缺失:主应用未产出,Tauri 包体将启动白屏。" +
      "若动过 rollupOptions.input,主入口 index.html 必须在其中占一行。",
  );
  process.exit(1);
}

console.log("[check-dist] dist/index.html 在,入口完整");
