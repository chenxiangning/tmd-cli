/**
 * 资产库存储契约测试(内存单源 + 通用 fs_* 落盘)。
 * 覆盖:agents.json 往返与选中持久化、名称撞车守卫、删除清理选中、
 * 提示词两级目录加载、工作区覆盖全局的可见性/正文解析、CRUD 与作用域移动。
 * ipc 以内存 map 桩替(configHomeDir/fsReadFile/fsWriteFile/fsWalkFiles/fsCreateDir/fsTrashEntry);
 * 被测模块是模块级单例,每用例 resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 内存文件系统:path → 文本;fsWalkFiles 按目录前缀枚举一层。 */
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
    fsWalkFiles: vi.fn(async (dir: string) => {
      const out: string[] = [];
      for (const path of files.keys()) {
        if (path.startsWith(dir + "/")) out.push(path.slice(dir.length + 1));
      }
      return out;
    }),
    fsCreateDir: vi.fn(async () => undefined),
    fsTrashEntry: vi.fn(async (path: string) => {
      files.delete(path);
    }),
  };
});

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => [{ id: "ws1", name: "甲", root: "/repo/甲" }],
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
  await store.loadAssets();
});

describe("智能体 CRUD 与选中", () => {
  it("saveAgent 落盘 agents.json,重启(loadAssets)后读回", async () => {
    await store.saveAgent({ name: "小张", icon: "🎨", prompt: "产品交互大神" });
    await store.selectAgent("sess-1", store.agentByName("小张")!.id);
    /* 边界形状:agents.json 是本 store 刚写入的自持久化格式,字段可信 */
    const raw = JSON.parse(ipcMock.files.get("/home/.tmd-cli/agents.json")!) as {
      agents: Record<string, { name: string }>;
    };
    expect(Object.values(raw.agents).map((a) => a.name)).toEqual(["小张"]);
    vi.resetModules();
    store = { ...(await import("./store")), ...(await import("./promptStore")) };
    await store.loadAssets();
    expect(store.agentByName("小张")?.prompt).toBe("产品交互大神");
    expect(store.selectedAgent("sess-1")?.name).toBe("小张");
  });

  it("名称撞车(大小写不敏感)返回 null,不覆盖已有条目", async () => {
    await store.saveAgent({ name: "小陈", prompt: "p1" });
    expect(await store.saveAgent({ name: "小陈", prompt: "p2" })).toBeNull();
    expect(await store.saveAgent({ name: "小陈 ", prompt: "p2" })).toBeNull();
    expect(store.agentByName("小陈")?.prompt).toBe("p1");
  });

  it("deleteAgent 同步清理各会话的 selectedBySession", async () => {
    const agent = (await store.saveAgent({ name: "小张", prompt: "p" }))!;
    await store.selectAgent("sess-1", agent.id);
    await store.deleteAgent(agent.id);
    expect(store.selectedAgent("sess-1")).toBeNull();
  });

  it("写盘失败返回 null 且内存回滚,恢复后可重存", async () => {
    ipcMock.fsWriteFile.mockRejectedValueOnce(new Error("EIO"));
    expect(await store.saveAgent({ name: "小张", prompt: "p" })).toBeNull();
    expect(store.agentByName("小张")).toBeNull();
    expect(await store.saveAgent({ name: "小张", prompt: "p" })).not.toBeNull();
  });

  it("deleteAgent 写盘失败返回 false 且内存回滚", async () => {
    const agent = (await store.saveAgent({ name: "小张", prompt: "p" }))!;
    ipcMock.fsWriteFile.mockRejectedValueOnce(new Error("EIO"));
    expect(await store.deleteAgent(agent.id)).toBe(false);
    expect(store.agentByName("小张")?.id).toBe(agent.id);
  });

  it("selectAgent 写盘失败返回 false 且选中回滚", async () => {
    const agent = (await store.saveAgent({ name: "小张", prompt: "p" }))!;
    ipcMock.fsWriteFile.mockRejectedValueOnce(new Error("EIO"));
    expect(await store.selectAgent("sess-1", agent.id)).toBe(false);
    expect(store.selectedAgent("sess-1")).toBeNull();
  });

  it("pruneSelectedSessions 剪除死会话 id 并落盘", async () => {
    const agent = (await store.saveAgent({ name: "小张", prompt: "p" }))!;
    await store.selectAgent("sess-1", agent.id);
    await store.selectAgent("sess-2", agent.id);
    await store.pruneSelectedSessions(new Set(["sess-1"]));
    expect(store.selectedAgent("sess-1")?.name).toBe("小张");
    expect(store.selectedAgent("sess-2")).toBeNull();
    const raw = JSON.parse(ipcMock.files.get("/home/.tmd-cli/agents.json")!) as {
      selectedBySession: Record<string, string>;
    };
    expect(Object.keys(raw.selectedBySession)).toEqual(["sess-1"]);
  });
});

describe("提示词加载与可见性", () => {
  beforeEach(() => {
    ipcMock.files.set("/home/.tmd-cli/prompts/review.md", "---\ndescription: 全局评审\n---\n\n全局正文");
    ipcMock.files.set("/home/.tmd-cli/workspaces/ws1/prompts/review.md", "工作区正文");
    ipcMock.files.set("/home/.tmd-cli/workspaces/ws1/prompts/ws-only.md", "只属工作区");
  });

  it("loadAssets 读两级目录;工作区级在前、同名覆盖全局", async () => {
    await store.loadAssets();
    /* 工作区组整体在前、组内按名排序;review 命中的是工作区版本 */
    expect(store.promptSuggestions("/repo/甲").map((s) => s.value)).toEqual(["review", "ws-only"]);
    expect(store.promptContent("review", "/repo/甲")).toBe("工作区正文");
  });

  it("cwd 不属任何工作区:只见全局", async () => {
    await store.loadAssets();
    expect(store.promptSuggestions("/elsewhere").map((s) => s.value)).toEqual(["review"]);
    expect(store.promptContent("review", "/elsewhere")).toBe("全局正文");
  });
});

describe("提示词 CRUD 与作用域移动", () => {
  it("savePrompt 写 md 文件;同作用域撞名返回 false", async () => {
    expect(await store.savePrompt("global", undefined, { name: "a", content: "x" })).toBe(true);
    expect(ipcMock.files.get("/home/.tmd-cli/prompts/a.md")).toBe("x");
    expect(await store.savePrompt("global", undefined, { name: "A", content: "y" })).toBe(false);
    /* 不同作用域同名允许 */
    expect(await store.savePrompt("workspace", "ws1", { name: "a", content: "z" })).toBe(true);
  });

  it("改名 = 新文件 + 旧文件进废纸篓", async () => {
    await store.savePrompt("global", undefined, { name: "old", content: "x" });
    await store.savePrompt("global", undefined, { name: "new", content: "x2" }, "old");
    expect(ipcMock.files.has("/home/.tmd-cli/prompts/old.md")).toBe(false);
    expect(ipcMock.files.get("/home/.tmd-cli/prompts/new.md")).toBe("x2");
    expect(store.promptSuggestions("/x").map((s) => s.value)).toEqual(["new"]);
  });

  it("movePrompt 全局 → 工作区:源删除、目标可见性立即生效", async () => {
    await store.savePrompt("global", undefined, { name: "mv", content: "正文" });
    const entry = store.promptSuggestions("/x").length;
    expect(entry).toBe(1);
    const moved = await store.movePrompt(
      { name: "mv", scope: "global", content: "正文" },
      "workspace",
      "ws1",
    );
    expect(moved).toBe(true);
    expect(store.promptSuggestions("/x").map((s) => s.value)).toEqual([]);
    expect(store.promptSuggestions("/repo/甲").map((s) => s.value)).toEqual(["mv"]);
    expect(ipcMock.files.get("/home/.tmd-cli/workspaces/ws1/prompts/mv.md")).toBe("正文");
  });

  it("非法名称拒绝(路径分隔符等),不落盘;trim 后合法名照存", async () => {
    expect(await store.savePrompt("global", undefined, { name: "a/b", content: "x" })).toBe(false);
    expect(await store.savePrompt("global", undefined, { name: "///", content: "x" })).toBe(false);
    expect(store.promptSuggestions("/x")).toEqual([]);
    expect(await store.savePrompt("global", undefined, { name: " 好 ", content: "x" })).toBe(true);
    expect(store.promptSuggestions("/x").map((s) => s.value)).toEqual(["好"]);
  });

  it("写盘失败返回 false,内存不新增", async () => {
    ipcMock.fsWriteFile.mockRejectedValueOnce(new Error("EIO"));
    expect(await store.savePrompt("global", undefined, { name: "x", content: "c" })).toBe(false);
    expect(store.promptSuggestions("/x")).toEqual([]);
  });
});
