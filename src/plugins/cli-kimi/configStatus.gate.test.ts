/**
 * kimi 全局配置态尺寸闸测试(G3,2026-10-06):readKimiConfigStatus 接
 * readStatusTailGated 后稳态(尺寸未变)不重读。tailGate 模块级单例 →
 * beforeEach resetModules(先例 cli-shared/piFamily.test.ts)。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const reads: string[] = [];
const fileBodies = new Map<string, string>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: () => Promise.resolve("/home/u"),
    fsReadFile: (p: string) => {
      reads.push(p);
      const body = fileBodies.get(p);
      return body === undefined ? Promise.reject(new Error("nf")) : Promise.resolve(body);
    },
    fsReadTailChanged: (p: string, max: number, lastSize: number | null) => {
      /* 探针(max=0,lastSize 在场)不计内容读 —— 闸的价值 = 消内容传输 */
      if (!(max === 0 && lastSize !== null)) reads.push(p);
      const body = fileBodies.get(p);
      if (body === undefined) return Promise.reject(new Error("nf"));
      const changed = lastSize === null || body.length !== lastSize;
      return Promise.resolve({ text: changed ? body.slice(-max) : "", size: body.length, changed });
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  reads.length = 0;
  fileBodies.clear();
});

describe("kimi config 尺寸闸", () => {
  it("稳态(同尺寸)二拍只读一次", async () => {
    fileBodies.set("/home/u/.kimi-code/config.toml", 'default_model = "kimi-k2"\n');
    const mod = await import("./configStatus");
    const s1 = await mod.readKimiConfigStatus();
    expect(s1?.model).toBe("kimi-k2");
    await mod.readKimiConfigStatus();
    expect(reads).toEqual(["/home/u/.kimi-code/config.toml"]);
  });

  it("主路径解析不出状态时兜底 ~/.kimi", async () => {
    fileBodies.set("/home/u/.kimi/config.toml", 'default_model = "kimi-k1"\n');
    const mod = await import("./configStatus");
    const s = await mod.readKimiConfigStatus();
    expect(s?.model).toBe("kimi-k1");
    expect(reads).toEqual(["/home/u/.kimi-code/config.toml", "/home/u/.kimi/config.toml"]);
  });
});
