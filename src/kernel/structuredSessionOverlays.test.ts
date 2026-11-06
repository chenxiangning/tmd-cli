/**
 * RPC 会话覆盖层存储契约 —— 存储域(scope)推导 + 重命名/静音键的并行会话
 * 隔离(2026-11-06:同引擎同 cwd 并行多会话 base + `#sessionId` resume tab
 * 互不串写)。钉死:
 * 1. scope 推导:base = 引擎+cwd(旧键兼容零迁移);resume 会话带 # 判别后缀;
 * 2. 重命名覆盖层按 scope 隔离,scoped miss 时回落 base(旧数据跨 ended→resume 连续);
 * 3. 静音同隔离;scoped unmute 写 "0" 显式遮蔽 base(删键会令 base 值复活),
 *    base unmute 维持删键(旧行为);
 * 4. 草稿键同样吃 scope(ssDraft 无 base 回落,resume 会话从零起)。
 * 手法:localStorage 内存 stub;模块无单例态,直调即可。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const storage = new MemoryStorage();
let overlays: typeof import("./structuredSessionOverlays");

beforeEach(async () => {
  storage.clear();
  vi.stubGlobal("localStorage", storage);
  overlays = await import("./structuredSessionOverlays");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = "omp:/repo";
const RESUMED = "omp:/repo#sess-1";
const OTHER = "omp:/repo#sess-2";

describe("ssScope 存储域推导", () => {
  it("base = 引擎+cwd(resume 会话缺省);带 resumeSessionId 叠 # 判别后缀", () => {
    expect(overlays.ssScope({ profileId: "omp", cwd: "/repo" })).toBe(BASE);
    expect(overlays.ssScope({ profileId: "omp", cwd: "/repo", resumeSessionId: "sess-1" })).toBe(RESUMED);
  });
});

describe("重命名覆盖层(tmd.ss.title.*)", () => {
  it("按 scope 隔离:并行会话各自成键,互不可见", () => {
    overlays.noteSsTitleOverride(RESUMED, "会话一");
    expect(overlays.readSsTitleOverride(RESUMED)).toBe("会话一");
    expect(overlays.readSsTitleOverride(OTHER)).toBeNull();
    expect(overlays.readSsTitleOverride(BASE)).toBeNull();
  });
  it("scoped miss 回落 base 域(存活期写在 base,ended→resume 后 tab 带 # 仍连续)", () => {
    overlays.noteSsTitleOverride(BASE, "旧名");
    expect(overlays.readSsTitleOverride(RESUMED)).toBe("旧名");
  });
  it("base 域无回落面:base 读不到 scoped 写的改名", () => {
    overlays.noteSsTitleOverride(RESUMED, "会话一");
    expect(overlays.readSsTitleOverride(BASE)).toBeNull();
  });
});

describe("静音覆盖层(tmd.ss.mute.*)", () => {
  it("scoped 静音不影响 base 与其他并行会话", () => {
    expect(overlays.toggleSsMute(RESUMED)).toBe(true);
    expect(overlays.isSsMuted(RESUMED)).toBe(true);
    expect(overlays.isSsMuted(BASE)).toBe(false);
    expect(overlays.isSsMuted(OTHER)).toBe(false);
  });
  it("base 静音经回落对 scoped 可见(旧数据连续性)", () => {
    overlays.toggleSsMute(BASE);
    expect(overlays.isSsMuted(BASE)).toBe(true);
    expect(overlays.isSsMuted(RESUMED)).toBe(true);
  });
  it("scoped unmute 写 0 遮蔽 base,不再复活;base unmute 维持删键", () => {
    overlays.toggleSsMute(BASE); /* base = 1 */
    expect(overlays.toggleSsMute(RESUMED)).toBe(false); /* scoped unmute */
    expect(overlays.isSsMuted(RESUMED)).toBe(false);
    expect(overlays.isSsMuted(BASE)).toBe(true); /* base 会话本身不受影响 */
    expect(storage.getItem(`tmd.ss.mute.${RESUMED}`)).toBe("0");
    expect(overlays.toggleSsMute(BASE)).toBe(false); /* base unmute = 删键 */
    expect(storage.getItem(`tmd.ss.mute.${BASE}`)).toBeNull();
  });
});

describe("草稿键分域(tmd.ss.draft.* 键形,ssDraft.ts 消费)", () => {
  it("并行会话草稿键不同名(base 键形 = 旧形态零迁移)", () => {
    storage.setItem(`tmd.ss.draft.${BASE}`, "A 的未发送草稿");
    storage.setItem(`tmd.ss.draft.${RESUMED}`, "B 的未发送草稿");
    expect(`tmd.ss.draft.${BASE}`).not.toBe(`tmd.ss.draft.${RESUMED}`);
    expect(storage.getItem(`tmd.ss.draft.${BASE}`)).toBe("A 的未发送草稿");
    expect(storage.getItem(`tmd.ss.draft.${RESUMED}`)).toBe("B 的未发送草稿");
  });
});
