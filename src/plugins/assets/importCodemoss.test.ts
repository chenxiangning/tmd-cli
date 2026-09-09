/**
 * codemoss 导入契约测试。
 * 覆盖:agent.json 合并(撞名加 (N) 后缀、坏行跳过、坏 JSON 不炸)、
 * prompts 目录导入(平铺约束:子目录跳过、撞名跳过、空文件跳过)、
 * frontmatter 字段经 promptMd 解析进库。
 * ipc 内存桩同 store.test.ts;被测模块单例,resetModules 取全新实例。
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
    fsWalkFiles: vi.fn(async (dir: string) => {
      const out: string[] = [];
      for (const path of files.keys()) {
        if (path.startsWith(dir + "/")) out.push(path.slice(dir.length + 1));
      }
      return out;
    }),
    fsCreateDir: vi.fn(async () => undefined),
    fsTrashEntry: vi.fn(async () => undefined),
  };
});

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => [],
  workspacesReady: Promise.resolve(),
}));

type StoreModule = typeof import("./store") & typeof import("./promptStore");
type ImportModule = typeof import("./importCodemoss");

let store: StoreModule;
let importer: ImportModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.files.clear();
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  // promptStore 与 store 共享同一 state 单源,合并句柄免逐调用点改名
  store = { ...(await import("./store")), ...(await import("./promptStore")) };
  importer = await import("./importCodemoss");
  await store.loadAssets();
});

describe("importCodemossAgents", () => {
  it("合并 agent.json;与库内撞名的加 (2) 后缀", async () => {
    await store.saveAgent({ name: "小张", prompt: "库内版" });
    ipcMock.files.set(
      "/home/.ccgui/agent.json",
      JSON.stringify({
        agents: {
          a1: { name: "小张", prompt: "codemoss 版", icon: "🎨" },
          a2: { name: "小陈", prompt: "架构师" },
        },
      }),
    );
    const report = await importer.importCodemossAgents();
    expect(report).toEqual({ agents: 2, prompts: 0, skipped: 0 });
    expect(store.agentByName("小张")?.prompt).toBe("库内版");
    expect(store.agentByName("小张 (2)")?.prompt).toBe("codemoss 版");
    expect(store.agentByName("小陈")?.prompt).toBe("架构师");
  });

  it("文件缺失 / 坏 JSON / 无名行:空报告不炸", async () => {
    expect(await importer.importCodemossAgents()).toEqual({ agents: 0, prompts: 0, skipped: 0 });
    ipcMock.files.set("/home/.ccgui/agent.json", "{坏");
    expect(await importer.importCodemossAgents()).toEqual({ agents: 0, prompts: 0, skipped: 0 });
    ipcMock.files.set("/home/.ccgui/agent.json", JSON.stringify({ agents: { x: { prompt: "无名" } } }));
    expect(await importer.importCodemossAgents()).toEqual({ agents: 0, prompts: 0, skipped: 1 });
  });
});

describe("importPromptDir", () => {
  it("平铺 md 入全局库,frontmatter 解析;子目录/空文件/撞名跳过", async () => {
    await store.savePrompt("global", undefined, { name: "dup", content: "已有" });
    ipcMock.files.set("/ext/review.md", "---\ndescription: 评审\nargument-hint: PR 号\n---\n\n评审 $PR");
    ipcMock.files.set("/ext/dup.md", "撞名跳过");
    ipcMock.files.set("/ext/empty.md", "  ");
    ipcMock.files.set("/ext/sub/nested.md", "子目录不进");
    ipcMock.files.set("/ext/notes.txt", "非 md 不进");
    const report = await importer.importPromptDir("/ext");
    expect(report).toEqual({ agents: 0, prompts: 1, skipped: 2 });
    const names = store.promptSuggestions("/x").map((s) => s.value);
    expect(names.sort()).toEqual(["dup", "review"]);
    expect(store.promptContent("review", "/x")).toBe("评审 $PR");
    expect(store.promptSuggestions("/x").find((s) => s.value === "review")?.description).toBe(
      "评审 · 参数: PR 号",
    );
    expect(store.promptContent("dup", "/x")).toBe("已有");
  });

  it("目录不可读 = 空报告", async () => {
    expect(await importer.importPromptDir("/不存在")).toEqual({ agents: 0, prompts: 0, skipped: 0 });
  });
});
