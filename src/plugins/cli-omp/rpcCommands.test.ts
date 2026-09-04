import { describe, expect, it, vi, beforeEach } from "vitest";
import { listOmpSuggestions, _fetchOmpCommandsForTest } from "./rpcCommands";
import { ipc } from "@kernel/ipc";

/* 模拟真实协议:回显请求 stdin 里的 id(适配器按 id 认领响应);
   数据形状 = 2026-09-04 本机实测 omp 18.1.6 get_available_commands(裁剪) */
const commandPayload = [
  { name: "security", description: "Plan, run, inspect", input: { hint: "<plan|scan>" }, subcommands: [{ name: "plan" }] },
  { name: "model", description: "Show current model selection" },
  { name: "skill:brainstorming", description: "You MUST use this before any creative work" },
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
    command: "get_available_commands",
    success: true,
    data: { commands: commandPayload },
  });
}

vi.mock("@kernel/ipc", () => ({
  ipc: {
    procCommunicate: vi.fn(async (spec: { stdin: string }) => ({
      stdout: `{"type":"extension_ui_request","id":"noise"}\n${responseLine(spec.stdin)}\n`,
      stderr: "",
      code: 0,
      timedOut: false,
    })),
  },
}));

beforeEach(() => {
  vi.mocked(ipc.procCommunicate).mockClear();
});

describe("omp RPC 命令适配器", () => {
  it("噪声事件中按 id 认领响应;skill: 前缀切片为 skill kind,input.hint 并入描述", async () => {
    const commands = await listOmpSuggestions("command", "/repo");
    const skills = await listOmpSuggestions("skill", "/repo");
    expect(commands?.map((c) => c.value)).toEqual(["security", "model"]);
    expect(commands?.[0].description).toContain("<plan|scan>");
    expect(skills?.map((s) => s.value)).toEqual(["brainstorming"]);
    /* 同 cwd 两次 kind 切片共享一次 spawn */
    expect(ipc.procCommunicate).toHaveBeenCalledTimes(1);
  });

  it("超时 → null;success=false → null(回退静态表)", async () => {
    vi.mocked(ipc.procCommunicate).mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      code: null,
      timedOut: true,
    });
    expect(await _fetchOmpCommandsForTest("/repo")).toBeNull();
    vi.mocked(ipc.procCommunicate).mockResolvedValueOnce({
      stdout: '{"id":"x","type":"response","success":false}\n',
      stderr: "",
      code: 1,
      timedOut: false,
    });
    expect(await _fetchOmpCommandsForTest("/repo")).toBeNull();
  });
});
