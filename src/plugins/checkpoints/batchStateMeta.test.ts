/**
 * 批状态元表与批次 tab 契约测试(并入同目录小模块 batchTab.ts)。
 * 覆盖契约:
 * - STATE_META 五态齐全,reverted 钉死回退色(无主题 token),其余走 --tmd-* token
 * - batchState:open 旗标优先于 state 字段(进行中批恒判 open);关闭态透传 state
 * - openBatchTab:id = `ckpt-batch:<batchId>`、payload 全字段透传、refresh 重开语义
 * - readBatchPayload:kind 不匹配 / 缺任一必填字段 → null;合法 payload 全字段还原
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CkptBatch } from "@kernel/ipc";
import type { EditorTab } from "@kernel/tabs";

const tabsMock = vi.hoisted(() => ({ openTab: vi.fn() }));
vi.mock("@kernel/tabs", () => tabsMock);

import { STATE_META, batchState } from "./batchStateMeta";
import { BATCH_TAB_KIND, openBatchTab, readBatchPayload } from "./batchTab";

function batch(state: CkptBatch["state"], open: boolean): CkptBatch {
  return {
    id: "b1",
    index: 1,
    open,
    ts: 1,
    tsEnd: null,
    sessionId: "cli-1",
    prompt: "p",
    engine: "",
    model: "",
    thinking: "",
    state,
    doneReason: null,
    guardId: null,
    attribution: "git",
    files: [],
  };
}

beforeEach(() => {
  tabsMock.openTab.mockClear();
});

describe("STATE_META 元数据判别", () => {
  it("五态齐全且都有 label/dot/chip", () => {
    expect(Object.keys(STATE_META).sort()).toEqual(
      ["approved", "done", "open", "pending", "reverted"].sort(),
    );
    for (const meta of Object.values(STATE_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.dot.length).toBeGreaterThan(0);
      expect(meta.chip.length).toBeGreaterThan(0);
    }
  });

  it("reverted 无主题 token,钉死回退紫 #a78bfa;其余四态走 --tmd-* token", () => {
    expect(STATE_META.reverted.dot).toBe("#a78bfa");
    expect(STATE_META.reverted.chip).toContain("#a78bfa");
    for (const key of ["open", "pending", "approved", "done"] as const) {
      expect(STATE_META[key].dot).toMatch(/var\(--tmd-/);
      expect(STATE_META[key].chip).toMatch(/--tmd-/);
    }
  });
});

describe("batchState 判别", () => {
  it("open 旗标优先:state 已是 pending/approved 也判 open(进行中批恒 open)", () => {
    expect(batchState(batch("pending", true))).toBe("open");
    expect(batchState(batch("approved", true))).toBe("open");
  });

  it("关闭态透传 state 字段", () => {
    expect(batchState(batch("approved", false))).toBe("approved");
    expect(batchState(batch("reverted", false))).toBe("reverted");
    expect(batchState(batch("done", false))).toBe("done");
  });
});

describe("openBatchTab", () => {
  it("id = ckpt-batch:<batchId>,kind/title/path/payload 全字段透传,refresh 重开", () => {
    openBatchTab({
      cwd: "/repo",
      sessionId: "cli-1",
      tmdSessionId: "tmd-1",
      batchId: "b7",
      title: "批次 7",
      focusPath: "src/a.ts",
    });

    expect(tabsMock.openTab).toHaveBeenCalledTimes(1);
    const [spec, opts] = tabsMock.openTab.mock.calls[0];
    expect(BATCH_TAB_KIND).toBe("ckpt-batch");
    expect(spec.id).toBe("ckpt-batch:b7");
    expect(spec.kind).toBe(BATCH_TAB_KIND);
    expect(spec.title).toBe("批次 7");
    expect(spec.path).toBe("/repo");
    expect(spec.payload).toEqual({
      cwd: "/repo",
      sessionId: "cli-1",
      tmdSessionId: "tmd-1",
      batchId: "b7",
      focusPath: "src/a.ts",
    });
    expect(opts).toEqual({ refresh: true });
  });

  it("可选字段缺省:tmdSessionId / focusPath 透传 undefined", () => {
    openBatchTab({ cwd: "/r", sessionId: "s", batchId: "b", title: "t" });

    const { payload } = tabsMock.openTab.mock.calls[0][0];
    expect(payload.tmdSessionId).toBeUndefined();
    expect(payload.focusPath).toBeUndefined();
  });
});

describe("readBatchPayload", () => {
  const tab = (kind: string, payload: unknown): EditorTab =>
    ({ kind, payload }) as unknown as EditorTab;

  it("kind 不匹配 → null", () => {
    expect(readBatchPayload(tab("other", { cwd: "/r", sessionId: "s", batchId: "b" }))).toBeNull();
  });

  it("缺任一必填字段或 payload 为 null → null", () => {
    expect(readBatchPayload(tab(BATCH_TAB_KIND, null))).toBeNull();
    expect(readBatchPayload(tab(BATCH_TAB_KIND, { sessionId: "s", batchId: "b" }))).toBeNull();
    expect(readBatchPayload(tab(BATCH_TAB_KIND, { cwd: "/r", batchId: "b" }))).toBeNull();
    expect(readBatchPayload(tab(BATCH_TAB_KIND, { cwd: "/r", sessionId: "s" }))).toBeNull();
  });

  it("合法 payload 全字段还原(含可选字段原样)", () => {
    const full = { cwd: "/r", sessionId: "s", tmdSessionId: "t", batchId: "b", focusPath: "f.ts" };
    expect(readBatchPayload(tab(BATCH_TAB_KIND, full))).toEqual(full);

    const min = { cwd: "/r", sessionId: "s", batchId: "b" };
    expect(readBatchPayload(tab(BATCH_TAB_KIND, min))).toEqual({
      cwd: "/r",
      sessionId: "s",
      tmdSessionId: undefined,
      batchId: "b",
      focusPath: undefined,
    });
  });
});
