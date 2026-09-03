/**
 * checkpoints store 契约测试(账本模型)。
 * 覆盖:清单 IPC 单次调用(副键 tmdSessionId 透传)、主键错误进 error 态、
 * E_NOT_A_REPO 置 notARepo、成功清单原样入仓。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CkptBatch } from "@kernel/ipc";

const ipcMock = vi.hoisted(() => ({
  checkpointList: vi.fn(),
  checkpointSealDead: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type StoreModule = typeof import("./store");

let store: StoreModule;

const CWD = "/repo";
/** 主键 = 已绑定的 CLI 磁盘身份;副键 = 绑定前锚点落名的 tmd 会话 id */
const CLI = "cli-1";
const TMD = "tmd-1";

function batch(id: string, turn: number): CkptBatch {
  return {
    id,
    index: turn,
    open: false,
    ts: turn,
    tsEnd: null,
    sessionId: CLI,
    prompt: "p",
    engine: "",
    model: "",
    thinking: "",
    state: "pending",
    doneReason: null,
    guardId: null,
    attribution: "git",
    files: [],
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  store = await import("./store");
});

describe("refreshBatches(账本单查询)", () => {
  it("单次 IPC,副键 tmdSessionId 原样透传;成功清单原样入仓", async () => {
    ipcMock.checkpointList.mockResolvedValue([batch("b1", 1), batch("b2", 3)]);

    await store.refreshBatches(CWD, CLI, TMD);

    expect(ipcMock.checkpointList).toHaveBeenCalledWith(CWD, CLI, TMD);
    const st = store.getCkptBatches(CWD, CLI);
    expect(st.error).toBeNull();
    expect(st.loading).toBe(false);
    expect(st.batches.map((b) => b.id)).toEqual(["b1", "b2"]);
    // 轮次号 = 账本记录,前端不重排
    expect(st.batches.map((b) => b.index)).toEqual([1, 3]);
  });

  it("未传副键:原样透传 undefined(空串归一在 ipc 层)", async () => {
    ipcMock.checkpointList.mockResolvedValue([]);

    await store.refreshBatches(CWD, CLI);

    expect(ipcMock.checkpointList).toHaveBeenCalledWith(CWD, CLI, undefined);
  });

  it("刷新失败:保留旧清单 + error 态 —— 一次瞬时失败不得把时间线打回「没有批次」", async () => {
    ipcMock.checkpointList.mockResolvedValueOnce([batch("b1", 1)]);
    await store.refreshBatches(CWD, CLI, TMD);

    /* Tauri invoke 拒绝值是裸字符串(非 Error) */
    ipcMock.checkpointList.mockRejectedValue("E_IO: boom");
    await store.refreshBatches(CWD, CLI, TMD);

    const st = store.getCkptBatches(CWD, CLI);
    expect(st.error).toContain("E_IO");
    /* 旧批保留,由面板的错误横幅标注数据非新鲜 */
    expect(st.batches.map((b) => b.id)).toEqual(["b1"]);
    expect(st.loading).toBe(false);
    expect(st.notARepo).toBe(false);

    /* 恢复成功:清单与 error 双双复位 */
    ipcMock.checkpointList.mockResolvedValue([batch("b2", 2)]);
    await store.refreshBatches(CWD, CLI, TMD);
    const ok = store.getCkptBatches(CWD, CLI);
    expect(ok.error).toBeNull();
    expect(ok.batches.map((b) => b.id)).toEqual(["b2"]);
  });

  it("首拉即失败:空清单 + error(面板渲染错误态,不冒充「本会话还没有批次」)", async () => {
    ipcMock.checkpointList.mockRejectedValue("E_GIT2: lock");

    await store.refreshBatches(CWD, CLI, TMD);

    const st = store.getCkptBatches(CWD, CLI);
    expect(st.error).toContain("E_GIT2");
    expect(st.batches).toEqual([]);
    expect(st.notARepo).toBe(false);
  });

  it("E_NOT_A_REPO:置 notARepo(UI 切非 git 工作区文案)", async () => {
    ipcMock.checkpointList.mockRejectedValue("E_NOT_A_REPO: nope");

    await store.refreshBatches(CWD, CLI, TMD);

    const st = store.getCkptBatches(CWD, CLI);
    expect(st.notARepo).toBe(true);
    expect(st.batches).toEqual([]);
  });

  it("cwd/sessionId 缺失:直接短路,不发起 IPC", async () => {
    await store.refreshBatches("", CLI);
    await store.refreshBatches(CWD, "");

    expect(ipcMock.checkpointList).not.toHaveBeenCalled();
  });
});

describe("sealDeadTurns(强退恢复)", () => {
  it("按 cwd 携带宽限触发一次;同 cwd 不重复;失败移除标记允许重收", async () => {
    ipcMock.checkpointSealDead.mockResolvedValue(2);
    await store.sealDeadTurns(CWD);

    expect(ipcMock.checkpointSealDead).toHaveBeenCalledWith(CWD, 60_000);
    await store.sealDeadTurns(CWD);
    expect(ipcMock.checkpointSealDead).toHaveBeenCalledTimes(1);

    /* 失败:标记回退,下次再收(重试语义与 pruneRetention 一致) */
    ipcMock.checkpointSealDead.mockRejectedValue("E_IO: boom");
    await store.sealDeadTurns("/other");
    await store.sealDeadTurns("/other");
    expect(ipcMock.checkpointSealDead).toHaveBeenCalledTimes(3);

    ipcMock.checkpointSealDead.mockResolvedValue(0);
    await store.sealDeadTurns("/other");
    expect(ipcMock.checkpointSealDead).toHaveBeenCalledTimes(4);
  });

  it("空 cwd 短路,不发起 IPC", async () => {
    await store.sealDeadTurns("");
    expect(ipcMock.checkpointSealDead).not.toHaveBeenCalled();
  });
});
