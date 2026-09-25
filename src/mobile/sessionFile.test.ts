/**
 * sessionFile 定位回归锚(评审 P1-1):旧实现的目录名反匹配双侧恒不等
 * (磁盘 slug 已把 / 替成 -,strip 掉 - 再比带 / 的 cwd 永不命中),
 * transcript 层在真机从未生效。钉死三家确定性 slug 目录形态。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: { configHomeDir: async () => "/home/u", quotaEnvValue: async () => null },
}));
vi.mock("@kernel/transport", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "fs_collect_files")
      return [
        { path: `${args.dir}/s1.jsonl`, modifiedAt: 2 },
        { path: `${args.dir}/s0.jsonl`, modifiedAt: 1 },
      ];
    return [];
  },
}));

import { resolveTranscriptPath } from "./sessionFile";

const CWD = "/Users/x/code/tmd-cli";

describe("resolveTranscriptPath 确定性 slug", () => {
  it("pi:~/.pi/agent/sessions/--cwd--", async () => {
    expect(await resolveTranscriptPath("pi", CWD)).toBe(
      "/home/u/.pi/agent/sessions/--Users-x-code-tmd-cli--/s1.jsonl",
    );
  });
  it("omp:~/.omp/agent/sessions/(根在 .omp 非 .pi;前导 / 保留为 -)", async () => {
    expect(await resolveTranscriptPath("omp", CWD)).toBe(
      "/home/u/.omp/agent/sessions/--Users-x-code-tmd-cli-/s1.jsonl",
    );
  });
  it("claude:~/.claude/projects/非字母数字划一", async () => {
    expect(await resolveTranscriptPath("claude", CWD)).toBe(
      "/home/u/.claude/projects/-Users-x-code-tmd-cli/s1.jsonl",
    );
  });
  it("qoder/kimi/grok/codex 不在手机 transcript 契约 → null", async () => {
    expect(await resolveTranscriptPath("qoder", CWD)).toBeNull();
    expect(await resolveTranscriptPath("kimi", CWD)).toBeNull();
  });
});
