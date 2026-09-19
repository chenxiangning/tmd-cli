/**
 * Claude 渠道应用 IO 路径契约测试(applyClaudeChannel;合并语义由
 * channelApply.test.ts 经 saveClaudeConfig 覆盖,本文件补 IPC 编排版)。
 * 覆盖:读 settings.json → 渠道三字段摊平进 env 三键(ANTHROPIC_BASE_URL /
 * ANTHROPIC_API_KEY / ANTHROPIC_MODEL)→ 备份先于写盘;渠道未定义字段保留
 * 现状(model-only 渠道不清现有 endpoint/key);空白字段先 trim、视同未定义;
 * 结构化段(hooks)与顶层 model 不被渠道改写;原文件缺失可从零创建。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  backupOnce: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: mocks.configHomeDir,
    fsReadFile: mocks.fsReadFile,
    fsWriteFile: mocks.fsWriteFile,
  },
}));

/* 渠道应用对 providerChannels 的依赖面只有 backupOnce,整 barrel 打桩
   避免 node 测试环境拉入 React 组件链。 */
vi.mock("@plugins/cli-shared/providerChannels", () => ({
  backupOnce: mocks.backupOnce,
}));

import { applyClaudeChannel } from "./channelApply";
import type { Channel } from "@plugins/cli-shared/providerChannels/types";

const HOME = "/Users/x";
const SETTINGS_PATH = `${HOME}/.claude/settings.json`;

function channel(over: Partial<Channel> = {}): Channel {
  return { id: "ch1", name: "中转站", createdAt: 0, ...over };
}

const EXISTING = `${JSON.stringify(
  {
    model: "sonnet",
    hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command" }] }] },
    env: {
      ANTHROPIC_BASE_URL: "https://old.example.com",
      ANTHROPIC_API_KEY: "sk-old",
      ANTHROPIC_MODEL: "claude-old",
    },
  },
  null,
  2,
)}\n`;

function writtenSettings(): Record<string, unknown> {
  const call = mocks.fsWriteFile.mock.calls.find((c) => c[0] === SETTINGS_PATH);
  expect(call, "settings.json 应被写盘一次").toBeDefined();
  return JSON.parse(call![1] as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configHomeDir.mockResolvedValue(HOME);
  mocks.fsReadFile.mockResolvedValue(EXISTING);
  mocks.fsWriteFile.mockResolvedValue(undefined);
  mocks.backupOnce.mockResolvedValue(`${SETTINGS_PATH}.bak-tmd`);
});

describe("applyClaudeChannel(IO 编排)", () => {
  it("三字段渠道摊平进 env 三键,结构化段与顶层 model 不动", async () => {
    await applyClaudeChannel(
      channel({ baseUrl: "https://newrelay.ai", apiKey: "sk-new", model: "claude-new" }),
    );
    const next = writtenSettings();
    expect(next.env).toEqual({
      ANTHROPIC_BASE_URL: "https://newrelay.ai",
      ANTHROPIC_API_KEY: "sk-new",
      ANTHROPIC_MODEL: "claude-new",
    });
    expect(next.model).toBe("sonnet");
    expect(next.hooks).toEqual({
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command" }] }],
    });
  });

  it("model-only 渠道保留现有 endpoint/key(不清既有凭据)", async () => {
    await applyClaudeChannel(channel({ model: "claude-new" }));
    const env = writtenSettings().env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://old.example.com");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-old");
    expect(env.ANTHROPIC_MODEL).toBe("claude-new");
  });

  it("渠道字段先 trim;空白串视同未定义回落现状", async () => {
    await applyClaudeChannel(channel({ baseUrl: " https://trim.ai ", apiKey: "   " }));
    const env = writtenSettings().env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://trim.ai");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-old");
    expect(env.ANTHROPIC_MODEL).toBe("claude-old");
  });

  it("原文件缺失:从零创建最小配置(env 三键、无顶层 model)", async () => {
    mocks.fsReadFile.mockRejectedValue(new Error("enoent"));
    await applyClaudeChannel(
      channel({ baseUrl: "https://fresh.ai", apiKey: "sk-fresh", model: "claude-fresh" }),
    );
    const next = writtenSettings();
    expect(next.env).toEqual({
      ANTHROPIC_BASE_URL: "https://fresh.ai",
      ANTHROPIC_API_KEY: "sk-fresh",
      ANTHROPIC_MODEL: "claude-fresh",
    });
    expect(next.model).toBeUndefined();
  });

  it("写盘前先备份,备份路径为 settings.json 本体", async () => {
    await applyClaudeChannel(channel({ baseUrl: "https://x.ai" }));
    expect(mocks.backupOnce).toHaveBeenCalledWith(SETTINGS_PATH);
    expect(mocks.backupOnce.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fsWriteFile.mock.invocationCallOrder[0],
    );
  });
});
