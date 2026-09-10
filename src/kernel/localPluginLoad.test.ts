/**
 * localPluginLoad 纯件契约测试:specifier 重写 / shim 文本 / manifest 校验 / 导出校验。
 */
import { describe, expect, it } from "vitest";
import type { Plugin } from "./plugin";
import {
  buildShimText,
  rewriteSpecifiers,
  synthesizeMeta,
  validateManifest,
  validatePluginExport,
} from "./localPluginLoad";

const shimUrl = (spec: string) => `blob:shim-${spec}`;

describe("rewriteSpecifiers 裸导入重写", () => {
  it("白名单命中(静态/动态/再导出/单双引号)全部重写,非白名单原样保留", () => {
    const src = [
      `import { useState } from "react";`,
      `import ReactDOM from 'react-dom';`,
      `import { jsx } from "react/jsx-runtime";`,
      `export { ipc } from "tmd-sdk";`,
      `const p = import("react");`,
      `import _ from "lodash";`,
      `const q = import("lodash-es");`,
    ].join("\n");
    const out = rewriteSpecifiers(src, shimUrl);
    expect(out).toContain(`from "blob:shim-react"`);
    expect(out).toContain(`from "blob:shim-react-dom"`);
    expect(out).toContain(`from "blob:shim-react/jsx-runtime"`);
    expect(out).toContain(`from "blob:shim-tmd-sdk"`);
    expect(out).toContain(`import("blob:shim-react")`);
    expect(out).toContain(`from "lodash";`);
    expect(out).toContain(`import("lodash-es")`);
  });

  it("react 前缀不误伤 react-dom / react-router", () => {
    const src = `import a from "react-dom";\nimport b from "react-router";`;
    const out = rewriteSpecifiers(src, shimUrl);
    expect(out).toContain(`from "blob:shim-react-dom"`);
    expect(out).toContain(`from "react-router"`);
  });
});

describe("buildShimText shim 生成", () => {
  it("具名导出按 key 生成;default 键生成默认导出而非非法标识符", () => {
    const text = buildShimText(["useState", "createElement", "default"]);
    expect(text).toContain(`export const useState = m["useState"];`);
    expect(text).toContain(`export const createElement = m["createElement"];`);
    expect(text).toContain(`export default m["default"];`);
    expect(text).not.toContain("export const default");
  });
});

describe("validateManifest 清单校验", () => {
  const builtins = new Set(["git", "files"]);
  const ok = { id: "hello", name: "H", category: "feature", apiVersion: 2 };

  it("合法清单放行", () => {
    expect(validateManifest(ok, builtins)).toBeNull();
  });

  it("与内置插件 id 冲突 → 拒绝", () => {
    expect(validateManifest({ ...ok, id: "git" }, builtins)).toContain("内置");
  });

  it("apiVersion 不符 → 拒绝", () => {
    expect(validateManifest({ ...ok, apiVersion: 99 }, builtins)).toContain("API");
    expect(validateManifest({ ...ok, apiVersion: undefined }, builtins)).toContain("API");
  });

  it("core 分类 → 拒绝(焊死层属内置)", () => {
    expect(validateManifest({ ...ok, category: "core" }, builtins)).toContain("core");
  });

  it("entry 含路径分隔 → 拒绝", () => {
    expect(validateManifest({ ...ok, entry: "../x.js" }, builtins)).toContain("入口");
  });
});

describe("validatePluginExport 导出校验", () => {
  const plugin: Plugin = {
    id: "hello",
    meta: { name: "H", abbr: "HE", desc: "", category: "feature" },
    activate: () => {},
  };

  it("默认导出或具名 plugin 均可;缺失 → 拒绝", () => {
    expect(validatePluginExport({ default: plugin }, "hello")).toBeNull();
    expect(validatePluginExport({ plugin }, "hello")).toBeNull();
    expect(validatePluginExport({}, "hello")).toContain("导出");
    expect(validatePluginExport({ default: 42 }, "hello")).toContain("导出");
  });

  it("导出 id 与 manifest 不一致 / 缺 activate → 拒绝", () => {
    expect(
      validatePluginExport({ default: { ...plugin, id: "other" } }, "hello"),
    ).toContain("不一致");
    expect(
      validatePluginExport({ default: { ...plugin, activate: undefined } }, "hello"),
    ).toContain("activate");
  });
});

describe("synthesizeMeta 由 manifest 合成 PluginMeta", () => {
  it("缺省字段兜底:abbr 取 id 前两位大写,category 非法值回退 feature", () => {
    const meta = synthesizeMeta({ id: "hello", name: "你好" });
    expect(meta.name).toBe("你好");
    expect(meta.abbr).toBe("HE");
    expect(meta.category).toBe("feature");
    expect(synthesizeMeta({ id: "e1", category: "engine" }).category).toBe("engine");
  });
});

