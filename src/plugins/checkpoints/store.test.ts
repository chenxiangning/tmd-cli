/**
 * checkpoints store 双键查询契约测试。
 * 覆盖:主键瞬时错误上抛进 error 态(不得静默丢清单)、副键错误降级为空合并、
 * 双键结果按批 id 去重 + ts 倒序。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CkptBatch } from "@kernel/ipc";

const ipcMock = vi.hoisted(() => ({
  checkpointList: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type StoreModule = typeof import("./store");

let store: StoreModule;

const CWD = "/repo";
/** 主键 = 已绑定的 CLI 磁盘身份;副键 = 绑定前锚点落名的 tmd 会话 id */
const MAIN = "cli-1";
const ALT = "tmd-1";

function batch(id: string, ts: number): CkptBatch {
  return {
    id,
    index: 1,
    open: false,
    ts,
    tsEnd: null,
    sessionId: MAIN,
    prompt: "p",
    state: "pending",
    doneReason: null,
    guardId: null,
    files: [],
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  store = await import("./store");
});

describe("refreshBatches 双键查询", () => {
  it("主键瞬时错误:上抛进 error 态,不得静默合并副键数据冒充完整清单", async () => {
    ipcMock.checkpointList.mockImplementation((_cwd: string, id: string) =>
      id === MAIN ? Promise.reject(new Error("E_IO: boom")) : Promise.resolve([batch("b-alt", 2)]),
    );

    await store.refreshBatches(CWD, MAIN, ALT);

    const st = store.getCkptBatches(CWD, MAIN);
    expect(st.error).toContain("E_IO");
    expect(st.batches).toEqual([]);
    expect(st.loading).toBe(false);
  });

  it("副键瞬时错误:降级为空合并,主键数据完整保留", async () => {
    ipcMock.checkpointList.mockImplementation((_cwd: string, id: string) =>
      id === MAIN
        ? Promise.resolve([batch("b-main", 1)])
        : Promise.reject(new Error("E_IO: boom")),
    );

    await store.refreshBatches(CWD, MAIN, ALT);

    const st = store.getCkptBatches(CWD, MAIN);
    expect(st.error).toBeNull();
    expect(st.batches.map((b) => b.id)).toEqual(["b-main"]);
  });

  it("双键合并:按批 id 去重,ts 倒序", async () => {
    ipcMock.checkpointList.mockImplementation((_cwd: string, id: string) =>
      id === MAIN
        ? Promise.resolve([batch("b1", 1), batch("b3", 3)])
        : Promise.resolve([batch("b2", 2), batch("b3", 3)]),
    );

    await store.refreshBatches(CWD, MAIN, ALT);

    const st = store.getCkptBatches(CWD, MAIN);
    expect(st.batches.map((b) => b.id)).toEqual(["b3", "b2", "b1"]);
  });

  it("副键 E_NOT_A_REPO:两键同 cwd 必然同命,上抛置 notARepo 而非降级", async () => {
    /* Tauri invoke 拒绝值是裸字符串(非 Error),isNotARepoError 按前缀匹配 */
    ipcMock.checkpointList.mockImplementation((_cwd: string, id: string) =>
      id === MAIN ? Promise.resolve([batch("b-main", 1)]) : Promise.reject("E_NOT_A_REPO: nope"),
    );

    await store.refreshBatches(CWD, MAIN, ALT);

    const st = store.getCkptBatches(CWD, MAIN);
    expect(st.notARepo).toBe(true);
    expect(st.batches).toEqual([]);
  });
});
