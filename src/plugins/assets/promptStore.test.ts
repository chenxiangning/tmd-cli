/**
 * 提示词库存储契约测试(promptStore.ts;CRUD 主干与两级目录加载已由 store.test.ts
 * 覆盖,本文件只补其未触达的契约面)。
 * 覆盖契约:
 * - movePrompt 目标作用域撞名(大小写不敏感):返回 false,源条目与源文件原样不动
 * - movePrompt 到全局:忽略 targetWsId,落在全局目录且全局可见
 * - deletePrompt:文件进废纸篓 + 出内存;废纸篓失败(文件已不在)仍删内存
 * - savePrompt 同名重存(oldName = name):不进废纸篓,元数据/正文可更新,内存不重复
 * - 跨工作区提示词不可见,也不遮蔽他侧全局同名提示词
 * - promptSuggestions 描述组合:description / 参数前缀 / 中点连接 / 皆无 undefined
 * - promptContent 按名大小写不敏感取正文,未知名返回空串
 * ipc 以内存 map 桩替(同 store.test.ts);被测模块单例,resetModules + 动态 import。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    configHomeDir: vi.fn(async () => "/home"),
    fsReadFile: vi.fn(async (path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    }),
    fsWriteFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    fsWalkFiles: vi.fn(async () => [] as string[]),
    fsCreateDir: vi.fn(async () => undefined),
    fsTrashEntry: vi.fn(async (path: string) => {
      files.delete(path);
    }),
  };
});

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => [
    { id: "ws1", name: "甲", root: "/repo/甲" },
    { id: "ws2", name: "乙", root: "/repo/乙" },
  ],
  workspacesReady: Promise.resolve(),
}));

type StoreModule = typeof import("./store") & typeof import("./promptStore");

let store: StoreModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.files.clear();
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  // promptStore 与 store 共享同一 state 单源(静态依赖同实例),合并句柄免逐调用点改名
  store = { ...(await import("./store")), ...(await import("./promptStore")) };
});

describe("movePrompt", () => {
  it("目标作用域撞名(大小写不敏感):false,源条目与源文件原样不动", async () => {
    await store.savePrompt("global", undefined, { name: "dup", content: "全局版" });
    await store.savePrompt("workspace", "ws1", { name: "Dup", content: "工作区版" });
    const moved = await store.movePrompt({ name: "dup", scope: "global", content: "全局版" }, "workspace", "ws1");
    expect(moved).toBe(false);
    /* 源未删:全局文件仍在、全局目录条目仍可见 */
    expect(ipcMock.files.get("/home/.tmd-cli/prompts/dup.md")).toBe("全局版");
    expect(store.promptSuggestions("/x").map((s) => s.value)).toEqual(["dup"]);
    /* 目标未被覆盖:工作区版正文原样 */
    expect(store.promptContent("dup", "/repo/甲")).toBe("工作区版");
  });

  it("移到全局:忽略 targetWsId,落在全局目录并全局可见", async () => {
    await store.savePrompt("workspace", "ws1", { name: "mv", content: "正文" });
    const moved = await store.movePrompt({ name: "mv", scope: "workspace", wsId: "ws1", content: "正文" }, "global", "ws1");
    expect(moved).toBe(true);
    expect(ipcMock.files.get("/home/.tmd-cli/prompts/mv.md")).toBe("正文");
    expect(ipcMock.files.has("/home/.tmd-cli/workspaces/ws1/prompts/mv.md")).toBe(false);
    /* 无工作区 cwd 也能看到全局条目 */
    expect(store.promptSuggestions("/x").map((s) => s.value)).toEqual(["mv"]);
  });
});

describe("deletePrompt", () => {
  it("文件进废纸篓并出内存", async () => {
    await store.savePrompt("global", undefined, { name: "gone", content: "x" });
    await store.deletePrompt({ name: "gone", scope: "global", content: "x" });
    expect(ipcMock.files.has("/home/.tmd-cli/prompts/gone.md")).toBe(false);
    expect(store.promptSuggestions("/x")).toEqual([]);
  });

  it("废纸篓失败(文件已不在)仍删内存,不抛错", async () => {
    await store.savePrompt("global", undefined, { name: "y", content: "x" });
    ipcMock.fsTrashEntry.mockRejectedValueOnce(new Error("ENOENT"));
    await store.deletePrompt({ name: "y", scope: "global", content: "x" });
    expect(store.promptSuggestions("/x")).toEqual([]);
  });
});

describe("savePrompt 同名重存", () => {
  it("oldName = name 不进废纸篓,元数据与正文可更新,内存不重复", async () => {
    await store.savePrompt("global", undefined, { name: "a", content: "旧正文" });
    const ok = await store.savePrompt(
      "global",
      undefined,
      { name: "a", description: "新描述", argumentHint: "PR 号", content: "新正文" },
      "a",
    );
    expect(ok).toBe(true);
    expect(ipcMock.fsTrashEntry).not.toHaveBeenCalled();
    const file = ipcMock.files.get("/home/.tmd-cli/prompts/a.md")!;
    expect(file).toContain("description: 新描述");
    expect(file).toContain("argument-hint: PR 号");
    expect(file).toContain("新正文");
    expect(store.promptSuggestions("/x")).toHaveLength(1);
    expect(store.promptContent("a", "/x")).toBe("新正文");
  });
});

describe("可见性与描述组合", () => {
  it("跨工作区提示词不可见,也不遮蔽他侧全局同名提示词", async () => {
    await store.savePrompt("workspace", "ws2", { name: "shared", content: "乙版" });
    await store.savePrompt("global", undefined, { name: "shared", content: "全局版" });
    /* ws1 的 cwd:乙工作区条目既不出现也不遮蔽全局 */
    expect(store.promptSuggestions("/repo/甲").map((s) => s.value)).toEqual(["shared"]);
    expect(store.promptContent("shared", "/repo/甲")).toBe("全局版");
    /* 归属工作区内覆盖全局 */
    expect(store.promptContent("shared", "/repo/乙")).toBe("乙版");
    expect(store.promptContent("shared", "/x")).toBe("全局版");
  });

  it("描述组合:仅 hint 加参数前缀;两者中点连接;皆无 undefined", async () => {
    await store.savePrompt("global", undefined, { name: "d1", description: "只有描述", content: "x" });
    await store.savePrompt("global", undefined, { name: "d2", argumentHint: "关键词", content: "x" });
    await store.savePrompt("global", undefined, { name: "d3", content: "x" });
    const byName = new Map(store.promptSuggestions("/x").map((s) => [s.value, s.description]));
    expect(byName.get("d1")).toBe("只有描述");
    expect(byName.get("d2")).toBe("参数: 关键词");
    expect(byName.get("d3")).toBeUndefined();
  });

  it("promptContent 大小写不敏感取正文;未知名返回空串", async () => {
    await store.savePrompt("global", undefined, { name: "Case", content: "正文X" });
    expect(store.promptContent("CASE", "/x")).toBe("正文X");
    expect(store.promptContent("case", "/x")).toBe("正文X");
    expect(store.promptContent("缺", "/x")).toBe("");
  });
});
