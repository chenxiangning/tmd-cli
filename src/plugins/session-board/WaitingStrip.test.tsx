/**
 * 看板「等待确认」置顶分区呈现面单测 —— 等待过滤 / 非空渲染 / 空集 null / 时长文案。
 * host 模块桩仅在 WaitingStrip 挂载面消费;纯呈现面直接注入 waitingIds。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ waiting: new Set<string>() }));

vi.mock("@kernel/host", () => ({
  host: {
    events: { on: () => () => {} },
    getSessions: () =>
      [...state.waiting].map((id) => ({ id, profileId: "omp", title: id })),
    isWaitingConfirm: (id: string) => state.waiting.has(id),
  },
}));
vi.mock("@kernel/settings", () => ({
  getSettingsState: () => ({ settings: { language: "zh" } }),
  subscribeSettings: () => () => {},
}));

import { WaitingStripView } from "./WaitingStrip";
import { noteWaitingAsk, resetWaitingSinceForTest } from "./waitingSince";
import type { BoardSession } from "./boardData";

function row(id: string, live = true, hostId = id): BoardSession {
  return {
    key: id,
    profileId: "omp",
    title: `会话 ${id}`,
    ts: 0,
    activeTs: 0,
    st: live ? "running" : "archived",
    live,
    hostId: live ? hostId : undefined,
  } as unknown as BoardSession;
}

beforeEach(() => resetWaitingSinceForTest());

describe("WaitingStripView", () => {
  it("只取 live × 等待中行;非等待/磁盘行不进分区", () => {
    const html = renderToStaticMarkup(
      <WaitingStripView
        rows={[row("a"), row("b", false), row("c", true, "c")]}
        waitingIds={new Set(["a"])}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain("会话 a");
    expect(html).not.toContain("会话 b");
    expect(html).not.toContain("会话 c");
  });

  it("全非等待渲染 null(分区仅非空时出现)", () => {
    expect(
      renderToStaticMarkup(
        <WaitingStripView rows={[row("a")]} waitingIds={new Set()} onOpen={() => undefined} />,
      ),
    ).toBe("");
  });

  it("有时长记录显示等待时长;无记录显示「等待中」不假起走", () => {
    vi.setSystemTime(5_400_000); /* 边沿记起算,再快进 89s → 分钟档 */
    noteWaitingAsk("a");
    vi.setSystemTime(5_489_000);
    const html = renderToStaticMarkup(
      <WaitingStripView
        rows={[row("a"), row("b")]}
        waitingIds={new Set(["a", "b"])}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain("等待 1 分钟");
    expect(html).toContain("等待中");
  });

  it("分区头计数与引擎色变量随行", () => {
    const html = renderToStaticMarkup(
      <WaitingStripView rows={[row("a")]} waitingIds={new Set(["a"])} onOpen={() => undefined} />,
    );
    expect(html).toContain("1 个会话");
    expect(html).toContain("--ec");
  });
});
