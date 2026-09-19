/**
 * suggest 查找候选契约:
 * - 触发符路由:ext 源(带 list)短路返回;/ $ 走静态表 × listSuggestions 合并;
 *   @ 走全仓索引模糊匹配;needle = tokenText 去掉触发符前缀(多字符触发符同规)。
 * - 静态过滤:前缀匹配大小写不敏感;不命中 = 空数组;空 needle = 全量截到上限 20。
 * - 动态合并:静态在前,动态按 value 去重只增不顶替;provider 抛错/回 null = 纯静态不炸。
 * - ext 装配:insertText 声明优先 → onPick 源空串回收(token 不写正文)→ char+value 回落;
 *   group/char 注入分区与触发符;onPick 闭包携带候选与选中时注入的 sessionId。
 * - file 装配:cwd 空 = 无候选;detail = cwd 补尾斜杠 + 相对路径(尾斜杠 cwd 不双拼);
 *   目录候选(尾 /)描述标「目录」。
 *
 * fileIndex 索引契约(并入的同目录小兄弟模块):
 * - root 空 = 无候选且不触 IPC;成功缓存 60s TTL 内不再拉取,过期重拉;
 * - 失败不缓存(返回 [],下次击键重试,不固化瞬时错误);
 * - 并发去重:同 root inflight 共享单请求;fuzzyFileMatch 转发导出保持既有导入路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfile, CliTriggerSpec } from "@kernel/cli";
import type { ComposerTriggerSource } from "@kernel/composerExt";
import { t } from "@kernel/i18n";

const ipcMock = vi.hoisted(() => ({
  fsWalkFiles: vi.fn<(root: string, cap: number) => Promise<string[]>>(),
}));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

/* 类型面顶层静态可见;运行期实例仍须 resetModules 后动态 import 取全新单例(见 beforeEach) */
type SuggestModule = typeof import("./suggest");
type FileIndexModule = typeof import("./fileIndex");

let suggest: SuggestModule;
let fileIndex: FileIndexModule;

beforeEach(async () => {
  vi.resetModules();
  ipcMock.fsWalkFiles.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  /* 模块级单例(fileIndex 索引缓存)必须借 resetModules 取全新实例 */
  suggest = await import("./suggest");
  fileIndex = await import("./fileIndex");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeProfile(overrides: Partial<CliProfile> = {}): CliProfile {
  return {
    id: "test-cli",
    name: "test",
    command: "test",
    args: [],
    triggers: [
      { char: "/", kind: "command" },
      { char: "$", kind: "skill" },
    ],
    suggestions: {
      command: [
        { value: "clear", description: "清屏" },
        { value: "model", description: "切换模型" },
      ],
      skill: [{ value: "plan", description: "规划" }],
    },
    ...overrides,
  };
}

describe("lookupSuggestions:静态命令/技能", () => {
  it("needle 去触发符后前缀过滤,大小写不敏感,kind 随触发符", async () => {
    const spec: CliTriggerSpec = { char: "/", kind: "command" };
    const hits = await suggest.lookupSuggestions(makeProfile(), spec, "/MO", "/w");
    expect(hits).toEqual([{ value: "model", description: "切换模型", kind: "command" }]);
  });

  it("不命中前缀 = 空数组(空态)", async () => {
    const hits = await suggest.lookupSuggestions(
      makeProfile(),
      { char: "/", kind: "command" },
      "/zzz",
      "/w",
    );
    expect(hits).toEqual([]);
  });

  it("空 needle = 全量,截到上限 20", async () => {
    const p = makeProfile({
      suggestions: { command: Array.from({ length: 25 }, (_, i) => ({ value: `cmd${i}` })) },
    });
    const hits = await suggest.lookupSuggestions(p, { char: "/", kind: "command" }, "/", "/w");
    expect(hits).toHaveLength(20);
  });

  it("技能触发符出 kind=skill 候选", async () => {
    const hits = await suggest.lookupSuggestions(makeProfile(), { char: "$", kind: "skill" }, "$", "/w");
    expect(hits).toEqual([{ value: "plan", description: "规划", kind: "skill" }]);
  });
});

describe("lookupSuggestions:动态发现合并", () => {
  it("静态在前,动态撞名去重只增不顶替", async () => {
    const p = makeProfile({
      listSuggestions: async () => [{ value: "extra" }, { value: "clear", description: "动态版" }],
    });
    const hits = await suggest.lookupSuggestions(p, { char: "/", kind: "command" }, "/", "/w");
    expect(hits.map((h) => h.value)).toEqual(["clear", "model", "extra"]);
    expect(hits[0].description).toBe("清屏"); // 静态条目保留,不被动态顶替
  });

  it("provider 抛错 = 纯静态,不向外抛", async () => {
    const p = makeProfile({ listSuggestions: async () => { throw new Error("boom"); } });
    const hits = await suggest.lookupSuggestions(p, { char: "/", kind: "command" }, "/cl", "/w");
    expect(hits.map((h) => h.value)).toEqual(["clear"]);
  });

  it("provider 回 null = 纯静态", async () => {
    const p = makeProfile({ listSuggestions: async () => null });
    const hits = await suggest.lookupSuggestions(p, { char: "/", kind: "skill" }, "$", "/w");
    expect(hits.map((h) => h.value)).toEqual(["plan"]);
  });
});

describe("lookupSuggestions:ext 触发源", () => {
  function extSrc(overrides: Partial<ComposerTriggerSource> = {}): ComposerTriggerSource {
    return {
      char: "!!",
      label: "提示词",
      list: () => [
        { value: "Deploy", description: "部署" },
        { value: "review", description: "评审" },
      ],
      ...overrides,
    };
  }

  it("多字符触发符剥前缀,前缀过滤大小写不敏感,注入 group/char", async () => {
    const hits = await suggest.lookupSuggestions(makeProfile(), extSrc(), "!!de", "/w");
    expect(hits).toEqual([
      { value: "Deploy", description: "部署", group: "提示词", char: "!!", insertText: "!!Deploy" },
    ]);
  });

  it("insertText 声明优先于 char+value 回落", async () => {
    const src = extSrc({ insertText: (s) => `>>${s.value}` });
    const hits = await suggest.lookupSuggestions(makeProfile(), src, "!!", "/w");
    expect(hits.map((h) => h.insertText)).toEqual([">>Deploy", ">>review"]);
  });

  it("onPick 源:insertText 空串回收 token,onPick 闭包带候选与 sessionId", async () => {
    const onPick = vi.fn();
    const src = extSrc({ onPick });
    const hits = await suggest.lookupSuggestions(makeProfile(), src, "!!", "/w");
    expect(hits[0].insertText).toBe("");
    hits[0].onPick?.("sid-9");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: "Deploy" }), "sid-9");
  });
});

describe("lookupSuggestions:@ 文件候选", () => {
  it("cwd 空 = 无候选,不触 IPC", async () => {
    const hits = await suggest.lookupSuggestions(makeProfile(), { char: "@", kind: "file" }, "@a", "");
    expect(hits).toEqual([]);
    expect(ipcMock.fsWalkFiles).not.toHaveBeenCalled();
  });

  it("命中模糊匹配:detail = cwd 补尾斜杠 + 相对路径,kind=file", async () => {
    ipcMock.fsWalkFiles.mockResolvedValue(["src/a.ts", "docs/"]);
    const hits = await suggest.lookupSuggestions(makeProfile(), { char: "@", kind: "file" }, "@a", "/ws");
    const file = hits.find((h) => h.value === "src/a.ts");
    expect(file).toMatchObject({ detail: "/ws/src/a.ts", kind: "file" });
    expect(file?.description).toBeUndefined();
  });

  it("目录候选(尾 /)描述标目录;cwd 自带尾斜杠不双拼", async () => {
    ipcMock.fsWalkFiles.mockResolvedValue(["docs/"]);
    const hits = await suggest.lookupSuggestions(makeProfile(), { char: "@", kind: "file" }, "@docs", "/ws/");
    expect(hits[0]).toMatchObject({ value: "docs/", detail: "/ws/docs/", kind: "file" });
    expect(hits[0].description).toBe(t("目录"));
  });
});

describe("projectFileIndex(并入 fileIndex):缓存与去重", () => {
  it("root 空 = 无候选且不触 IPC", async () => {
    expect(await fileIndex.projectFileIndex("")).toEqual([]);
    expect(ipcMock.fsWalkFiles).not.toHaveBeenCalled();
  });

  it("TTL 内命中缓存:同 root 二次调用不重复拉取", async () => {
    vi.useFakeTimers();
    ipcMock.fsWalkFiles.mockResolvedValue(["a.ts"]);
    expect(await fileIndex.projectFileIndex("/ws")).toEqual(["a.ts"]);
    expect(await fileIndex.projectFileIndex("/ws")).toEqual(["a.ts"]);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledTimes(1);
  });

  it("TTL 过期后重拉(60s)", async () => {
    vi.useFakeTimers();
    ipcMock.fsWalkFiles.mockResolvedValue(["a.ts"]);
    await fileIndex.projectFileIndex("/ws");
    vi.advanceTimersByTime(60_001);
    ipcMock.fsWalkFiles.mockResolvedValue(["a.ts", "b.ts"]);
    expect(await fileIndex.projectFileIndex("/ws")).toEqual(["a.ts", "b.ts"]);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledTimes(2);
  });

  it("失败不缓存:本次返回 [],下次击键重试", async () => {
    ipcMock.fsWalkFiles.mockRejectedValueOnce(new Error("ipc down"));
    expect(await fileIndex.projectFileIndex("/ws")).toEqual([]);
    ipcMock.fsWalkFiles.mockResolvedValueOnce(["b.ts"]);
    expect(await fileIndex.projectFileIndex("/ws")).toEqual(["b.ts"]);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledTimes(2);
  });

  it("并发去重:inflight 期共享单请求,落地后走缓存", async () => {
    let resolve!: (v: string[]) => void;
    ipcMock.fsWalkFiles.mockImplementation(
      () => new Promise<string[]>((res) => { resolve = res; }),
    );
    const p1 = fileIndex.projectFileIndex("/ws");
    const p2 = fileIndex.projectFileIndex("/ws");
    resolve(["x.ts"]);
    expect(await p1).toEqual(["x.ts"]);
    expect(await p2).toEqual(["x.ts"]);
    expect(await fileIndex.projectFileIndex("/ws")).toEqual(["x.ts"]);
    expect(ipcMock.fsWalkFiles).toHaveBeenCalledTimes(1);
  });

  it("fuzzyFileMatch 转发导出保持既有导入路径可用", () => {
    expect(fileIndex.fuzzyFileMatch(["a.ts", "b.md"], "ts", 5)).toEqual(["a.ts"]);
  });
});
