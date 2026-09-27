/**
 * 回窗待办卡单测 —— store 状态机 + 呈现面(renderToStaticMarkup,ExitSessionNotices 同款)。
 * host/settings 模块级桩:isWaitingConfirm 按 waiting 集翻真;订阅面走 Overlay 组件验。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string; profileId: string; title: string }>,
  waiting: new Set<string>(),
}));

vi.mock("@kernel/host", () => ({
  host: {
    events: { on: () => () => {} },
    getSessions: () => state.sessions,
    isWaitingConfirm: (id: string) => state.waiting.has(id),
    isWindowFocused: () => true,
    getActiveSessionId: () => null,
    getCliProfile: () => undefined,
    getCliSessionId: () => undefined,
  },
}));
vi.mock("@kernel/settings", () => ({
  getSettingsState: () => ({ settings: { sessionTitles: {}, language: "zh" } }),
  subscribeSettings: () => () => {},
}));

import {
  addReturnRow,
  closeReturnCard,
  openOnFocusReturn,
  resetReturnCardForTest,
  resolveReturnRow,
  returnCardSnapshot,
} from "./returnCardStore";
import { ReturnCardView } from "./returnCard";

function seed(): void {
  state.sessions = [
    { id: "s1", profileId: "omp", title: "标题一" },
    { id: "s2", profileId: "claude", title: "标题二" },
  ];
}

beforeEach(() => {
  seed();
  state.waiting.clear();
  resetReturnCardForTest();
});

describe("returnCard store", () => {
  it("无等待不开卡;有等待现查开卡(空集不打扰)", () => {
    openOnFocusReturn();
    expect(returnCardSnapshot().ids).toEqual([]);

    state.waiting.add("s1");
    openOnFocusReturn();
    expect(returnCardSnapshot().ids).toEqual(["s1"]);
  });

  it("行解决逐个移除,清空即收卡", () => {
    state.waiting.add("s1");
    state.waiting.add("s2");
    openOnFocusReturn();
    resolveReturnRow("s1");
    expect(returnCardSnapshot().ids).toEqual(["s2"]);
    resolveReturnRow("s2");
    expect(returnCardSnapshot().ids).toEqual([]);
  });

  it("聚焦期入卡:未开卡 no-op,开着追加且不重复", () => {
    addReturnRow("s1");
    expect(returnCardSnapshot().ids).toEqual([]);

    state.waiting.add("s1");
    openOnFocusReturn();
    addReturnRow("s1"); /* 重复 no-op */
    expect(returnCardSnapshot().ids).toEqual(["s1"]);

    addReturnRow("s2"); /* 未在卡内 → 追加 */
    expect(returnCardSnapshot().ids).toEqual(["s1", "s2"]);
  });

  it("手关幂等;行未入卡时移除是静默空操作", () => {
    state.waiting.add("s1");
    openOnFocusReturn();
    closeReturnCard();
    closeReturnCard();
    expect(returnCardSnapshot().ids).toEqual([]);
    resolveReturnRow("s1");
    expect(returnCardSnapshot().ids).toEqual([]);
  });
});

describe("ReturnCardView 呈现面", () => {
  it("计数 + 行(引擎/标题/等待签)+ role=alert;会话已逝回落短码", () => {
    state.waiting.add("s1");
    state.waiting.add("s2");
    openOnFocusReturn();
    const html = renderToStaticMarkup(<ReturnCardView ids={["s1", "s2", "ghost-x"]} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("3 个会话在等你确认");
    expect(html).toContain("标题一");
    expect(html).toContain("标题二");
    expect(html).toContain("ghost-x"); /* 找不到 meta:短码兜底可见 */
  });

  it("空快照渲染 null", () => {
    expect(renderToStaticMarkup(<ReturnCardView ids={[]} />)).toBe("");
  });
});
