/**
 * 覆盖层容量逐出行为契约测试(overlayEvict.ts)。
 * 覆盖:sessionOverlayKey 三段拼装、makeOverlay 的 has/mark/unmark/markMany、
 * mark 幂等刷新时间戳、满额按 tsField 逐出最旧条目(且绝不逐出新写 key)、
 * markMany 整表合并单次写盘、空数组 no-op、unmark 未标记 no-op。
 * settings 以内存表 fake(本仓 node 环境不加载 Tauri,真 settings 走 persist 链)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* settings fake:patch 合并语义与真实现一致(state.settings = {...state, ...patch}) */
const store: Record<string, unknown> = {};

vi.mock("./settings", () => ({
  getSettingsState: () => ({ settings: store }),
  updateSettings: (patch: Record<string, unknown>) => Object.assign(store, patch),
}));

import { makeOverlay, sessionOverlayKey } from "./overlayEvict";

interface Entry {
  ts: number;
}

let clock = 0;

function newOverlay(max = 200) {
  return makeOverlay<Entry>("sessionArchive", "ts", max);
}

beforeEach(() => {
  /* overlay 表缺省在场(与真 settings sanitize 后形态一致) */
  Object.assign(store, { sessionArchive: {}, sessionDeleted: {}, sessionKeep: {} });
  clock = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});

describe("sessionOverlayKey", () => {
  it("三段身份以冒号拼装", () => {
    expect(sessionOverlayKey("ws1", "claude", "s-9")).toBe("ws1:claude:s-9");
  });
});

describe("makeOverlay 基础契约", () => {
  it("mark 后 has 为真;unmark 后为假;unmark 未标记为 no-op 不写盘", () => {
    const ov = newOverlay();
    expect(ov.has("a")).toBe(false);
    ov.mark("a");
    expect(ov.has("a")).toBe(true);
    ov.unmark("a");
    expect(ov.has("a")).toBe(false);
    /* 未标记 unmark:no-op(store 引用不变,不抛错) */
    const before = { ...store };
    ov.unmark("ghost");
    expect(store).toEqual(before);
  });

  it("重复 mark 刷新时间戳(幂等)", () => {
    const ov = newOverlay();
    ov.mark("a");
    clock += 500;
    ov.mark("a");
    const table = store.sessionArchive as Record<string, Entry>;
    expect(Object.keys(table)).toEqual(["a"]);
    expect(table.a.ts).toBe(1_500);
  });

  it("markMany 空数组 no-op 不写盘", () => {
    const ov = newOverlay();
    ov.markMany([]);
    expect(store.sessionArchive).toEqual({});
  });

  it("markMany 批量合并一次写盘", () => {
    const ov = newOverlay();
    ov.markMany(["a", "b"]);
    const table = store.sessionArchive as Record<string, Entry>;
    expect(Object.keys(table).sort()).toEqual(["a", "b"]);
  });
});

describe("容量逐出", () => {
  it("满额时逐出最旧条目,新写 key 不被逐出", () => {
    const ov = newOverlay(2);
    ov.mark("old1");
    clock += 10;
    ov.mark("old2");
    clock += 10;
    ov.mark("new");
    const table = store.sessionArchive as Record<string, Entry>;
    expect(Object.keys(table).sort()).toEqual(["new", "old2"]);
  });

  it("markMany 全部是新写 key 时超限不误删(整批受保护,超限交 sanitize 兜底)", () => {
    const ov = newOverlay(2);
    ov.markMany(["a", "b", "c", "d"]);
    const table = store.sessionArchive as Record<string, Entry>;
    expect(Object.keys(table).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("markMany 超限时逐出保护集(本批 key)之外的最旧条目直至收敛", () => {
    const ov = newOverlay(2);
    ov.mark("old1");
    clock += 10;
    ov.mark("old2");
    clock += 10;
    ov.markMany(["n1", "n2"]);
    const table = store.sessionArchive as Record<string, Entry>;
    expect(Object.keys(table).sort()).toEqual(["n1", "n2"]);
  });

  it("重复 mark 已有 key 刷新后不因变新而自保他者被误逐方向反转", () => {
    /* 刷新 old2 的时间戳后 old1 成为最旧,逐出的必须是 old1 */
    const ov = newOverlay(2);
    ov.mark("old1");
    ov.mark("old2");
    clock += 100;
    ov.mark("old2"); /* 刷新 */
    clock += 100;
    ov.mark("new");
    const table = store.sessionArchive as Record<string, Entry>;
    expect(Object.keys(table).sort()).toEqual(["new", "old2"]);
  });

  it("markMany 混合已有 key:整表合并且排除集含新写与刷新 key", () => {
    const ov = newOverlay(2);
    ov.mark("old1");
    clock += 10;
    ov.mark("old2");
    clock += 10;
    ov.markMany(["old2", "new"]);
    const table = store.sessionArchive as Record<string, Entry>;
    expect(Object.keys(table).sort()).toEqual(["new", "old2"]);
    expect(table.old2.ts).toBe(1_020);
  });
});
