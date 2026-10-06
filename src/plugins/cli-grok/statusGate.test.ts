/**
 * grok/kimi 状态读取尺寸闸测试(G3,2026-10-06):readGrokSessionStatus /
 * readKimiConfigStatus 接 readStatusTailGated 后,稳态(尺寸未变)不重读,
 * 尺寸变化放行重读。tailGate 模块级单例 → beforeEach resetModules(先例
 * cli-shared/piFamily.test.ts)。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const reads: string[] = [];
let fileSizes = new Map<string, number>();
let fileBodies = new Map<string, string>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: () => Promise.resolve("/home/u"),
    /* grok 会话目录定位链走 configHomeDir + encodeURIComponent */
    fsReadFile: (p: string) => {
      reads.push(p);
      const body = fileBodies.get(p);
      return body === undefined ? Promise.reject(new Error("nf")) : Promise.resolve(body);
    },
    fsReadTail: (p: string, max: number) => {
      reads.push(p);
      const body = fileBodies.get(p);
      if (body === undefined) return Promise.reject(new Error("nf"));
      /* 尾窗语义:取尾部 max 字节 + 尺寸 */
      return Promise.resolve({
        text: body.slice(-max),
        size: fileSizes.get(p) ?? body.length,
        changed: true,
      });
    },
    fsReadTailChanged: (p: string, max: number, lastSize: number | null) => {
      /* 探针(max=0,lastSize 在场)不计内容读 —— 闸的价值 = 消内容传输 */
      if (!(max === 0 && lastSize !== null)) reads.push(p);
      const body = fileBodies.get(p);
      if (body === undefined) return Promise.reject(new Error("nf"));
      const size = fileSizes.get(p) ?? body.length;
      const changed = lastSize === null || size !== lastSize;
      return Promise.resolve({ text: changed ? body.slice(-max) : "", size, changed });
    },
  },
}));

const grokSummary = JSON.stringify({ info: { id: "g1", cwd: "/w" }, session_summary: "t", created_at: 1, updated_at: 2, current_model_id: "grok-4" });

beforeEach(() => {
  vi.resetModules();
  reads.length = 0;
  fileSizes = new Map();
  fileBodies = new Map();
});

describe("grok 状态尺寸闸", () => {
  it("稳态(同尺寸)二拍只读一次;尺寸变化放行重读", async () => {
    const dir = `/home/u/.grok/sessions/${encodeURIComponent("/w")}/g1/summary.json`;
    fileBodies.set(dir, grokSummary);
    const mod = await import("./sessions");
    const cwd = "/w";
    const s1 = await mod.readGrokSessionStatus(cwd, "g1");
    expect(s1?.model).toBe("grok-4");
    await mod.readGrokSessionStatus(cwd, "g1");
    expect(reads).toEqual([dir]); /* 同尺寸短路 */
    fileBodies.set(dir, grokSummary.slice(0, -1) + " }"); /* 内容+尺寸变 */
    const s2 = await mod.readGrokSessionStatus(cwd, "g1");
    expect(reads).toEqual([dir, dir]);
    expect(s2?.model).toBe("grok-4");
  });
});
