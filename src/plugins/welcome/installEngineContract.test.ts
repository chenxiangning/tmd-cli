/**
 * 前后端安装引擎清单一致性契约 —— 回归守护(2026-09-02 qoder 事故):
 * EngineCard 把 meta.binary 原样传给 Rust `cli_install_run` 的 CliInstallEngine,
 * 两边清单脱节时 serde 报 "unknown variant",安装按钮静默失败。
 *
 * Rust 侧已有编译期穷举(npm_package match),唯一缺口是"前端加了引擎、Rust 忘了补"——
 * 本测试从 installer.rs 源码解析枚举变体,要求与 ENGINE_METAS 的 binary 集合相等。
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_METAS } from "./engineMeta";

/** serde rename_all = "camelCase" 对变体名的转换(下划线分词)。 */
function serdeCamelCase(variant: string): string {
  const words = variant.split("_");
  return words
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("");
}

/** 从 installer.rs 源码提取 CliInstallEngine 全部变体的 camelCase 串。 */
function rustEngineNames(): string[] {
  const source = readFileSync(
    new URL("../../../src-tauri/src/installer.rs", import.meta.url),
    "utf8",
  );
  const body = source.match(/pub enum CliInstallEngine \{([^}]*)\}/)?.[1];
  if (!body) throw new Error("installer.rs 中找不到 CliInstallEngine 枚举");
  return [...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*),$/gm)].map((m) =>
    serdeCamelCase(m[1]),
  );
}

describe("安装引擎清单契约(ENGINE_METAS ↔ CliInstallEngine)", () => {
  it("欢迎页每个 binary 都能被 Rust 枚举反序列化", () => {
    const rust = new Set(rustEngineNames());
    const missing = ENGINE_METAS.filter((m) => !rust.has(m.binary));
    expect(
      missing.map((m) => `${m.id}(${m.binary})`),
      `以下引擎的 binary 不在 src-tauri/src/installer.rs 的 CliInstallEngine 中,` +
        `app 内「更新/安装」会报 unknown variant:请补枚举变体 + npm_package 分支`,
    ).toEqual([]);
  });

  it("枚举变体没有前端不认识的多余项(双向集合相等)", () => {
    const frontend = new Set(ENGINE_METAS.map((m) => m.binary));
    const extra = rustEngineNames().filter((n) => !frontend.has(n));
    expect(
      extra,
      `installer.rs 存在 ENGINE_METAS 未覆盖的变体:欢迎页无法触达,` +
        `请确认 engineMeta.ts 是否漏了引擎卡片`,
    ).toEqual([]);
  });
});
