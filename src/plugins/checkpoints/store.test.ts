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

  it("错误上抛进 error 态,清单清空,不得以空数据冒充完整账本", async () => {
    /* Tauri invoke 拒绝值是裸字符串(非 Error) */
    ipcMock.checkpointList.mockRejectedValue("E_IO: boom");

    await store.refreshBatches(CWD, CLI, TMD);

    const st = store.getCkptBatches(CWD, CLI);
    expect(st.error).toContain("E_IO");
    expect(st.batches).toEqual([]);
    expect(st.loading).toBe(false);
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
