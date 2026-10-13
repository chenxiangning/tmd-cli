/**
 * vite optimizeDeps 契约 —— 重库 lazy import 的依赖必须钉进启动期预打包。
 *
 * vite 扫描器看不见纯动态 import();依赖不在 include 清单时 dev 冷启动不预打包,
 * 会话中途首次触达才现场优化并强制整页 reload;跨 pnpm-lock 变化重优化时半截缓存
 * 撕裂模块图,dynamic import 被拒 → React.lazy 缓存 rejection → 插件贡献位熔断。
 * 已两次实证:2026-09-29 files(tags is not iterable,文件树入口消失)、
 * 2026-10-13 intent-canvas(Importing a module script failed,画布 tab 熔断——
 * 加 @uiw/react-codemirror 时把 @excalidraw/excalidraw 行顶掉所酿)。
 * 本闸防「加新依赖顶掉旧行」的编辑事故;再钉重库时同步补进 REQUIRED_PINNED_DEPS。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONFIG_SOURCE = readFileSync(
  fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
  "utf8",
);

/* 与 vite.config.ts optimizeDeps.include 一张网:动态 import 重库的钉装清单。 */
const REQUIRED_PINNED_DEPS = ["@excalidraw/excalidraw", "@uiw/react-codemirror"];

describe("optimizeDeps.include 重库钉装契约", () => {
  it("已知重库 lazy import 依赖全部在清单", () => {
    const includeStart = CONFIG_SOURCE.indexOf("include: [");
    expect(includeStart).toBeGreaterThan(-1);
    const includeEnd = CONFIG_SOURCE.indexOf("],", includeStart);
    expect(includeEnd).toBeGreaterThan(includeStart);
    const includeBlock = CONFIG_SOURCE.slice(includeStart, includeEnd);
    for (const dep of REQUIRED_PINNED_DEPS) {
      expect(includeBlock, `${dep} 应钉在 optimizeDeps.include`).toContain(`"${dep}"`);
    }
  });
});
