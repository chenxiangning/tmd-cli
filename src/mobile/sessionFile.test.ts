/**
 * sessionFile 定位回归锚(评审 P1-1):旧实现的目录名反匹配双侧恒不等
 * (磁盘 slug 已把 / 替成 -,strip 掉 - 再比带 / 的 cwd 永不命中),
 * transcript 层在真机从未生效。钉死三家确定性 slug 目录形态;
 * 2026-09-28 批补 codex/kimi 全局树按内容归属定位 + 行型自证解析。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: { configHomeDir: async () => "/home/u", quotaEnvValue: async () => null },
}));

const UUID1 = "aaaaaaaa-0000-4000-8000-000000000001";
const UUID2 = "aaaaaaaa-0000-4000-8000-000000000002";
const UUID3 = "aaaaaaaa-0000-4000-8000-000000000003";
const CODEX_META = JSON.stringify({
  type: "session_meta",
  id: "0192f0c1-1111-2222-3333-444455556666",
  cwd: "/Users/x/code/tmd-cli",
  timestamp: "2026-09-28T00:00:00.000Z",
});

vi.mock("@kernel/transport", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "config_home_dir") return "/home/u";
    if (cmd === "fs_collect_files") {
      if (args.dir === "/home/u/.codex/sessions")
        return [
          { path: `${args.dir}/2026/09/28/rollout-a.jsonl`, modifiedAt: 2 },
          { path: `${args.dir}/2026/09/27/rollout-b.jsonl`, modifiedAt: 1 },
        ];
      if (args.dir === "/home/u/.kimi-code/sessions")
        return [
          { path: `${args.dir}/wd1/session_ab12/agents/main/wire.jsonl`, modifiedAt: 2 },
          { path: `${args.dir}/wd2/session_cd34/agents/main/wire.jsonl`, modifiedAt: 1 },
        ];
      /* 通用目录(pi/omp/claude 族):uuid 文件名 + 新旧两代,测身份绑定。 */
      return [
        { path: `${args.dir}/2026-10-05T00-00-00-000Z_${UUID1}.jsonl`, modifiedAt: 2 },
        { path: `${args.dir}/2026-10-04T00-00-00-000Z_${UUID2}.jsonl`, modifiedAt: 1 },
        { path: `${args.dir}/${UUID3}.jsonl`, modifiedAt: 1 },
      ];
    }
    if (cmd === "fs_read_head" && String(args.path).endsWith("rollout-a.jsonl")) return CODEX_META;
    if (cmd === "fs_read_head" && String(args.path).endsWith("rollout-b.jsonl"))
      return CODEX_META.replace("/Users/x/code/tmd-cli", "/other/ws");
    if (cmd === "fs_read_file" && String(args.path).endsWith("session_ab12/state.json"))
      return JSON.stringify({ id: "session_ab12", cwd: "/Users/x/code/tmd-cli" });
    if (cmd === "fs_read_file" && String(args.path).endsWith("session_cd34/state.json"))
      return JSON.stringify({ id: "session_cd34", cwd: "/other/ws" });
    return [];
  },
}));

import { loadTranscriptAt, resolveTranscriptPath } from "./sessionFile";

const CWD = "/Users/x/code/tmd-cli";

describe("resolveTranscriptPath 确定性 slug", () => {
  it("pi:~/.pi/agent/sessions/--cwd--", async () => {
    expect(await resolveTranscriptPath("pi", CWD)).toBe(
      `/home/u/.pi/agent/sessions/--Users-x-code-tmd-cli--/2026-10-05T00-00-00-000Z_${UUID1}.jsonl`,
    );
  });
  it("omp:~/.omp/agent/sessions/(根在 .omp 非 .pi;前导 / 保留为 -)", async () => {
    expect(await resolveTranscriptPath("omp", CWD)).toBe(
      `/home/u/.omp/agent/sessions/--Users-x-code-tmd-cli-/2026-10-05T00-00-00-000Z_${UUID1}.jsonl`,
    );
  });
  it("claude:~/.claude/projects/非字母数字划一", async () => {
    expect(await resolveTranscriptPath("claude", CWD)).toBe(
      `/home/u/.claude/projects/-Users-x-code-tmd-cli/2026-10-05T00-00-00-000Z_${UUID1}.jsonl`,
    );
  });
  it("qoder/grok 不在手机 transcript 契约 → null", async () => {
    expect(await resolveTranscriptPath("qoder", CWD)).toBeNull();
    expect(await resolveTranscriptPath("grok", CWD)).toBeNull();
  });
  it("spawnedAt 水位:全部 stamp 早于水位 → null(新会话懒落盘期不命中同 cwd 旧会话,历史泄露修复)", async () => {
    expect(await resolveTranscriptPath("pi", CWD, 3)).toBeNull();
    expect(await resolveTranscriptPath("claude", CWD, 99)).toBeNull();
  });
  it("水位内仍取最新(mtime ≥ sinceMs)", async () => {
    expect(await resolveTranscriptPath("pi", CWD, 2)).toBe(
      `/home/u/.pi/agent/sessions/--Users-x-code-tmd-cli--/2026-10-05T00-00-00-000Z_${UUID1}.jsonl`,
    );
  });
});

describe("resolveTranscriptPath codex/kimi 全局树内容归属", () => {
  it("codex:mtime 倒序读头,session_meta cwd 命中即返", async () => {
    expect(await resolveTranscriptPath("codex", CWD)).toBe(
      "/home/u/.codex/sessions/2026/09/28/rollout-a.jsonl",
    );
  });
  it("codex:水位滤掉全部候选 → null", async () => {
    expect(await resolveTranscriptPath("codex", CWD, 3)).toBeNull();
  });
  it("kimi:wire.jsonl 水位内,state.json cwd 命中即返", async () => {
    expect(await resolveTranscriptPath("kimi", CWD)).toBe(
      "/home/u/.kimi-code/sessions/wd1/session_ab12/agents/main/wire.jsonl",
    );
  });
  it("kimi:水位滤掉全部候选 → null", async () => {
    expect(await resolveTranscriptPath("kimi", CWD, 3)).toBeNull();
  });
});

describe("resolveTranscriptPath 会话身份精确绑定(2026-10-04 评审 P1 回归)", () => {
  it("omp/pi:cliSessionId 命中 `<ts>_<uuid>.jsonl`,不拿同 cwd 更新的别家会话", async () => {
    expect(await resolveTranscriptPath("pi", CWD, undefined, UUID2)).toBe(
      `/home/u/.pi/agent/sessions/--Users-x-code-tmd-cli--/2026-10-04T00-00-00-000Z_${UUID2}.jsonl`,
    );
  });
  it("claude:`<uuid>.jsonl` 裸名命中(ts 前缀条目更新也不抢)", async () => {
    expect(await resolveTranscriptPath("claude", CWD, undefined, UUID3)).toBe(
      `/home/u/.claude/projects/-Users-x-code-tmd-cli/${UUID3}.jsonl`,
    );
  });
  it("codex:rollout 名含 id 命中,免读头探测(cwd 不匹配的旧文件也精确返回)", async () => {
    expect(await resolveTranscriptPath("codex", CWD, undefined, "rollout-b")).toBe(
      "/home/u/.codex/sessions/2026/09/27/rollout-b.jsonl",
    );
  });
  it("kimi:session_<id> 目录段命中(不逐 state.json 探测)", async () => {
    expect(await resolveTranscriptPath("kimi", CWD, undefined, "cd34")).toBe(
      "/home/u/.kimi-code/sessions/wd2/session_cd34/agents/main/wire.jsonl",
    );
  });
  it("id 未命中磁盘(懒落盘窗)→ 回落最新,不因带 id 而空手", async () => {
    expect(await resolveTranscriptPath("pi", CWD, undefined, "bbbbbbbb-0000-4000-8000-000000000009")).toBe(
      `/home/u/.pi/agent/sessions/--Users-x-code-tmd-cli--/2026-10-05T00-00-00-000Z_${UUID1}.jsonl`,
    );
  });
});

describe("loadTranscriptAt 读失败路径", () => {
  it("mock 面不含 fs_read_tail → null(UI 回落实况,不抛)", async () => {
    expect(await loadTranscriptAt("/home/u/.codex/sessions/rollout-a.jsonl")).toBeNull();
  });
});
