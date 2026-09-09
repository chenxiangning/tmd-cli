/**
 * 发送变换(智能体角色块)契约测试。
 * 覆盖:选中智能体尾拼 markdown 块(codemoss 同构格式)、命令形态("/" 开头)跳过、
 * 无选中/无会话/选中已被删 = fail-open 原文。
 * ipc 内存桩同 store.test.ts。
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
    fsTrashEntry: vi.fn(async () => undefined),
  };
});

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => [],
  workspacesReady: Promise.resolve(),
}));

type StoreModule = typeof import("./store");
type BlockModule = typeof import("./agentBlock");

let store: StoreModule;
let block: BlockModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.files.clear();
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  store = await import("./store");
  block = await import("./agentBlock");
  await store.loadAssets();
  await store.saveAgent({ name: "小张", prompt: "产品交互大神,先给结论" });
});

describe("assetsSendTransform", () => {
  it("选中智能体:消息尾拼角色块(codemoss 同构)", async () => {
    await store.selectAgent("s1", store.agentByName("小张")!.id);
    expect(block.assetsSendTransform("看看这个交互", "s1")).toBe(
      "看看这个交互\n\n## Agent Role and Instructions\n\nAgent Name: 小张\n\n产品交互大神,先给结论",
    );
  });

  it('命令形态("/" 开头)不拼块 —— 抽屉/手敲命令不吃角色污染', async () => {
    await store.selectAgent("s1", store.agentByName("小张")!.id);
    expect(block.assetsSendTransform("/clear", "s1")).toBe("/clear");
    expect(block.assetsSendTransform("/skill:review 一下", "s1")).toBe("/skill:review 一下");
  });

  it("未选中 / 无会话 / 选中后被删:fail-open 原文", async () => {
    expect(block.assetsSendTransform("原文", "s1")).toBe("原文");
    expect(block.assetsSendTransform("原文", null)).toBe("原文");
    const id = store.agentByName("小张")!.id;
    await store.selectAgent("s2", id);
    await store.deleteAgent(id);
    expect(block.assetsSendTransform("原文", "s2")).toBe("原文");
  });
});
