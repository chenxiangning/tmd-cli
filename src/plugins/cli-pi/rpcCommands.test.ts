import { describe, expect, it, vi, beforeEach } from "vitest";
import { listPiSuggestions, _fetchPiCommandsForTest } from "./rpcCommands";
import { ipc } from "@kernel/ipc";

/* 模拟真实协议:回显请求 id;数据形状 = 2026-09-04 本机实测 pi 0.84.4 get_commands
   (裁剪;docs/rpc.md §get_commands) */
const commandPayload = [
  { name: "lean-ctx", description: "Show lean-ctx status", source: "extension" },
  { name: "fix-tests", description: "Fix failing tests", source: "prompt" },
  { name: "skill:brave-search", description: "Web search via Brave API", source: "skill" },
];

function responseLine(requestStdin: string): string {
  const parsed: unknown = JSON.parse(requestStdin);
  const id =
    parsed && typeof parsed === "object" && "id" in parsed && typeof parsed.id === "string"
      ? parsed.id
      : "";
  return JSON.stringify({
    id,
    type: "response",
    command: "get_commands",
    success: true,
    data: { commands: commandPayload },
  });
}

vi.mock("@kernel/ipc", () => ({
  ipc: {
    procCommunicate: vi.fn(async (spec: { stdin: string }) => ({
      stdout: `${responseLine(spec.stdin)}\n`,
      stderr: "",
      code: 0,
      timedOut: false,
    })),
  },
}));

beforeEach(() => {
  vi.mocked(ipc.procCommunicate).mockClear();
});

describe("pi RPC 命令适配器", () => {
  it("source 分类:skill 前缀切 skill kind,extension/prompt 归 command", async () => {
    const commands = await listPiSuggestions("command", "/repo");
    const skills = await listPiSuggestions("skill", "/repo");
    expect(commands?.map((c) => c.value)).toEqual(["lean-ctx", "fix-tests"]);
    expect(skills?.map((s) => s.value)).toEqual(["brave-search"]);
    expect(ipc.procCommunicate).toHaveBeenCalledTimes(1);
    /* 请求体:--no-session --offline,不落会话不触网 */
    const spec = vi.mocked(ipc.procCommunicate).mock.calls[0][0];
    expect(spec.args).toEqual(["--mode", "rpc", "--no-session", "--offline"]);
    expect(spec.exitOnStdout).toBeTruthy();
  });

  it("无 id 匹配响应 → null", async () => {
    vi.mocked(ipc.procCommunicate).mockResolvedValueOnce({
      stdout: '{"type":"agent_start"}\n',
      stderr: "",
      code: 0,
      timedOut: false,
    });
    expect(await _fetchPiCommandsForTest("/repo")).toBeNull();
  });
});
