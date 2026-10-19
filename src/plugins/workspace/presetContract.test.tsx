/**
 * 会话预设入口契约(候选4)── 入口消失 = 功能不可达(消费者可见回归):
 * ① 工作区右键菜单恒显「会话预设」段(本地工作区,空库给引导);
 * ② 来源工作区(WSL/SSH)不显预设段(建链 = 本地 spawn,同 worktree 项先例);
 * ③ 引擎候选空 → 预设行禁点 + 说明。
 * 手法同 entryContract.test(portal 平铺内联,node 环境无 document;
 * store 消费端以桩只验渲染面,store 语义另有专门测试)。
 */
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactDOM from "react-dom";
import type * as SessionPresetsModule from "./sessionPresets";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDOM>();
  return { ...actual, createPortal: (node: React.ReactNode) => node };
});
vi.mock("@kernel/i18n", () => ({
  t: (k: string, params?: Record<string, unknown>) =>
    params
      ? Object.entries(params).reduce((acc, [key, v]) => acc.replaceAll(`{${key}}`, String(v)), k)
      : k,
  registerMessages: () => undefined,
}));
vi.stubGlobal("document", { body: {} });
vi.mock("@kernel/host", () => ({
  host: {
    events: { on: () => () => undefined, emit: () => undefined },
    getSessions: () => [],
    getCliProfiles: () => [],
    getCliProfile: (id: string) =>
      id === "claude" ? { id: "claude", name: "claude", command: "claude", args: [] } : undefined,
    createSession: () => Promise.resolve({ id: "pty-x" }),
  },
}));
/* 预设 worktree 启动链(runWorktreeCreate/worktreeSession)连带 import 面;渲染面不触达。 */
vi.mock("@kernel/ipc", () => ({ ipc: {} }));
vi.mock("@kernel/settings", () => ({
  useSettingsState: () => ({ settings: { workspaceGroups: [] } }),
  updateSettings: () => undefined,
  getSettingsState: () => ({ settings: {} }),
}));
const { originState, engineState } = vi.hoisted(() => ({
  originState: { origin: null as object | null },
  engineState: { empty: false },
}));
vi.mock("@kernel/workspaceOrigins", () => ({ findWorkspaceOrigin: () => originState.origin }));
vi.mock("@kernel/Mounts", () => ({ Mounts: () => null }));
vi.mock("./groups", () => ({ assignToGroup: () => undefined }));
vi.mock("@kernel/menuClamp", () => ({
  clampToViewport: (x: number, y: number) => ({ x, y }),
  clampMenuPosition: (x: number, y: number) => ({ x, y }),
}));
vi.mock("@kernel/useFocusTrap", () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock("@kernel/DialogShell", () => ({ useEscClose: () => undefined }));
vi.mock("@plugins/workbench/defaultEngine", () => ({
  defaultEngineCandidates: () => (engineState.empty ? [] : [{ id: "claude", name: "claude" }]),
  resolveDefaultEngine: () => null,
}));
vi.mock("@plugins/assets/promptStore", () => ({
  promptContent: (name: string) => `${name} 正文`,
}));
/* store 桩:useSyncExternalStore server 渲染需 getServerSnapshot,渲染面用固定数据。 */
vi.mock("./sessionPresets", async (importOriginal) => {
  const actual: typeof SessionPresetsModule = await importOriginal();
  return {
    ...actual,
    useSessionPresets: () => ({
      loaded: true,
      presets: [
        { id: "p1", name: "审阅配方", engineId: "claude", prompt: { text: "全文" } },
        {
          id: "p2",
          name: "修 CI",
          engineId: "claude",
          worktree: true,
          prompt: { ref: { scope: "global", name: "检查单" } },
        },
      ],
    }),
  };
});

import { SessionMenuOverlay } from "./SessionMenu";

function renderMenu(): string {
  return renderToStaticMarkup(
    createElement(SessionMenuOverlay, {
      workspace: { id: "ws1", name: "tmd-cli", root: "/tmp/ws" },
      canRemove: true,
      position: { x: 60, y: 60 },
      refreshing: {},
      onRefresh: () => undefined,
      onRename: () => undefined,
      onWorktree: () => undefined,
      onManagePresets: () => undefined,
      onClose: () => undefined,
    } as never),
  );
}

describe("会话预设入口契约", () => {
  it("① 本地工作区菜单恒显「会话预设」段:预设行可点 + 管理入口(空库走引导文案)", () => {
    const html = renderMenu();
    expect(html).toContain("会话预设");
    expect(html).toContain("审阅配方");
    expect(html).toContain("管理预设…");
    expect(html).not.toContain("disabled");
  });

  it("② 来源工作区(WSL/SSH)不显预设段(建链 = 本地 spawn)", () => {
    originState.origin = {};
    const html = renderMenu();
    expect(html).not.toContain("会话预设");
    originState.origin = null;
  });

  it("③ 引擎候选空 → 预设行禁点 + 如实说明(防空 spawn)", () => {
    engineState.empty = true;
    const html = renderMenu();
    expect(html).toContain("disabled");
    expect(html).toContain("未检测到可用引擎,无法启动预设");
    engineState.empty = false;
  });

  it("④ 行信息密度(候选4 定稿):范围/引用 pill + 描述行如实呈现,不猜测", () => {
    const html = renderMenu();
    expect(html).toContain("新 worktree");
    expect(html).toContain("引用「检查单」");
    expect(html).toContain("消费时现读,库更新即跟随");
    /* 内联文本预设:描述 = 原文预览 */
    expect(html).toContain("全文");
  });
});
