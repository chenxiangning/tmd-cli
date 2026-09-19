/**
 * inspectSkills.test.ts ── grok 技能清单解析契约(模块级 cached 单例,逐用例
 * vi.resetModules + 动态 import,参考 terminalLinks.test.ts 范式):
 * 1. kind 分流:command 恒回 null(静态表兜底),不触发 inspect。
 * 2. skills 清单映射:仅 userInvocable !== false 且有 name 的项产出
 *    {value: 裸 name, description, action: "insert"};裸 name 而非 invocableAs。
 * 3. 纯参考技能(userInvocable: false)与无名项被过滤。
 * 4. inspect 失败(null)与 skills 非数组回 null。
 * 5. 成功结果按 cwd 缓存;null 失败不缓存,下次重试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryCliRawJson = vi.fn();

vi.mock("../cli-shared/cliQuery", () => {
  class CachedCliQuery<T> {
    private cache = new Map<string, T>();
    constructor(private fetcher: (cwd: string) => Promise<T | null>) {}
    get(cwd: string): Promise<T | null> {
      const hit = this.cache.get(cwd);
      if (hit !== undefined) return Promise.resolve(hit);
      return this.fetcher(cwd).then((v) => {
        if (v !== null) this.cache.set(cwd, v);
        return v;
      });
    }
  }
  return { CachedCliQuery, queryCliRawJson };
});

async function load() {
  return await import("./inspectSkills");
}

beforeEach(() => {
  vi.resetModules();
  queryCliRawJson.mockReset();
});

describe("listGrokSuggestions", () => {
  it("command kind 恒回 null 且不发起 inspect", async () => {
    const { listGrokSuggestions } = await load();
    await expect(listGrokSuggestions("command", "/w")).resolves.toBeNull();
    expect(queryCliRawJson).not.toHaveBeenCalled();
  });

  it("技能清单映射为裸 name 插入建议,带描述", async () => {
    queryCliRawJson.mockResolvedValue({
      skills: [
        { name: "review", description: "代码评审", userInvocable: true },
        { name: "refs", description: "参考资料", userInvocable: false },
        { name: "dup", description: "撞名", userInvocable: true, invocableAs: "local:dup" },
        { description: "无名项", userInvocable: true },
      ],
    });
    const { listGrokSuggestions } = await load();
    await expect(listGrokSuggestions("skill", "/w")).resolves.toEqual([
      { value: "review", description: "代码评审", action: "insert" },
      { value: "dup", description: "撞名", action: "insert" },
    ]);
  });

  it("userInvocable 缺省视为可调用", async () => {
    queryCliRawJson.mockResolvedValue({ skills: [{ name: "s1", description: "d" }] });
    const { listGrokSuggestions } = await load();
    const out = await listGrokSuggestions("skill", "/w");
    expect(out).toEqual([{ value: "s1", description: "d", action: "insert" }]);
  });

  it("inspect 失败(null)与 skills 非数组均回 null", async () => {
    const { listGrokSuggestions } = await load();
    queryCliRawJson.mockResolvedValue(null);
    await expect(listGrokSuggestions("skill", "/w")).resolves.toBeNull();
    queryCliRawJson.mockResolvedValue({ skills: "bad" });
    await expect(listGrokSuggestions("skill", "/w")).resolves.toBeNull();
    queryCliRawJson.mockResolvedValue({});
    await expect(listGrokSuggestions("skill", "/w")).resolves.toBeNull();
  });

  it("成功结果按 cwd 缓存不再重复 spawn;失败不缓存会重试", async () => {
    queryCliRawJson.mockResolvedValue({ skills: [{ name: "s", description: "d" }] });
    const { listGrokSuggestions } = await load();
    await listGrokSuggestions("skill", "/w");
    await listGrokSuggestions("skill", "/w");
    expect(queryCliRawJson).toHaveBeenCalledTimes(1);
    await listGrokSuggestions("skill", "/other");
    expect(queryCliRawJson).toHaveBeenCalledTimes(2);

    queryCliRawJson.mockResolvedValue(null);
    await listGrokSuggestions("skill", "/w2");
    await listGrokSuggestions("skill", "/w2");
    expect(queryCliRawJson).toHaveBeenCalledTimes(4);
  });

  it("inspect 调用参数为 grok inspect --json 加 cwd", async () => {
    queryCliRawJson.mockResolvedValue({ skills: [] });
    const { listGrokSuggestions } = await load();
    await listGrokSuggestions("skill", "/w");
    expect(queryCliRawJson).toHaveBeenCalledWith({ command: "grok", args: ["inspect", "--json"], cwd: "/w" });
  });
});
