/**
 * tab 内容路由契约 —— 每个「可打开的 kind」必须有渲染方。
 *
 * 打开侧(openFileInTab 的 "file"、SftpTree 的 "ssh-file" 等)与注册侧
 * (registerTabContent 的 kind)分属不同插件,字符串字面量一旦脱节,
 * 症状是点击后编辑区永远停在空态(无报错)。这里激活全量插件捕获注册集,
 * 与已知可打开 kind 做双向锁定;新增可打开 kind 时同步本表。
 */

import { describe, expect, it, vi } from "vitest";

/* 并行 WIP(composer ⌘K 收编)在 activate 期注册 DOM 键监听;node 测试环境
   给最小桩 —— 只让全量激活可跑,不模拟任何行为。 */
vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
import type { TabContentContribution } from "@kernel/tabs";
import type { PluginContext } from "@kernel/plugin";
import { allPlugins } from "@plugins/index";

/** 已知会被 openTab 打开的全部 kind(打开侧字面量/常量的镜像)。 */
const OPENABLE_KINDS = [
  "file",
  "ssh-file",
  "git-commit-diff",
  "git-diff",
  "ckpt-batch",
  "memory-console",
] as const;

function activateCollectingKinds(): Set<string> {
  const kinds = new Set<string>();
  const ctx = {
    registerCliProfile: () => {},
    contribute: () => {},
    registerSettingsSection: () => {},
    registerFilePanel: () => {},
    registerCommand: () => {},
    registerTabContent: (c: TabContentContribution) => kinds.add(c.kind),
    registerMarketPanel: () => {},
    registerHomePanel: () => {},
    registerSessionCanvas: () => {},
    registerSidebarAction: () => {},
    registerFileVisual: () => {},
    events: { on: () => () => {}, off: () => {}, emit: () => {} },
  } as unknown as PluginContext;
  for (const plugin of allPlugins) {
    void plugin.activate(ctx);
  }
  return kinds;
}
/* 全量激活一次(模块级注册表抛重复,不能每用例重激活),两用例共享。 */
const REGISTERED_KINDS = activateCollectingKinds();

describe("tab 内容路由契约(openable kind ↔ registerTabContent)", () => {
  it("每个可打开的 kind 都有插件注册渲染组件", () => {
    const registered = REGISTERED_KINDS;
    const missing = OPENABLE_KINDS.filter((k) => !registered.has(k));
    expect(
      missing,
      `以下 kind 可被 openTab 打开但无 registerTabContent 渲染方,` +
        `点击后将永远空态:${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("注册的 kind 没有不可打开的多余项(双向相等)", () => {
    const registered = REGISTERED_KINDS;
    const extra = [...registered].filter((k) => !OPENABLE_KINDS.includes(k as never));
    expect(
      extra,
      `存在没有任何打开路径的注册 kind,属于死注册:${extra.join(", ")}`,
    ).toEqual([]);
  });
});
