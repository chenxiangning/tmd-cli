/**
 * mcp-hub/hubStore 契约测试 —— 引擎解析(tri-state/JSON 首建/TOML 隐藏)
 * 与写回安全(先 .bak-tmd 后写盘;未知键保留;TOML 缺失拒写)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  fsCollectFiles: vi.fn(),
  configHomeDir: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsReadFile: mocks.fsReadFile,
    fsWriteFile: mocks.fsWriteFile,
    fsCollectFiles: mocks.fsCollectFiles,
    configHomeDir: mocks.configHomeDir,
  },
}));
vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: () => [
      {
        id: "omp",
        name: "omp",
        mcpGlobalConfig: { candidates: ["/.omp/agent/mcp.json"], format: "json" },
      },
      {
        id: "codex",
        name: "codex",
        mcpGlobalConfig: { candidates: ["/.codex/config.toml"], format: "toml" },
      },
    ],
  },
}));

import { getHubEngines, refreshHub, removeServer, upsertServer } from "./hubStore";

const HOME = "/home/u";
const JSON_PATH = `${HOME}/.omp/agent/mcp.json`;
const TOML_PATH = `${HOME}/.codex/config.toml`;
const CLAUDE_LIKE = JSON.stringify({ other: { keep: true }, mcpServers: { a: { type: "stdio", command: "x" } } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configHomeDir.mockResolvedValue(HOME);
  mocks.fsCollectFiles.mockResolvedValue([]);
  mocks.fsWriteFile.mockResolvedValue(undefined);
});

describe("refreshHub 引擎解析", () => {
  it("JSON 家缺失 = 尚未创建(首存即建);TOML 家缺失 = 引擎隐藏", async () => {
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    await refreshHub();
    const engines = getHubEngines();
    expect(engines.map((e) => e.profileId)).toEqual(["omp"]); // codex(TOML 缺失)不列
    expect(engines[0].exists).toBe(false);
    expect(engines[0].entries).toEqual({});
    expect(engines[0].path).toBe(JSON_PATH);
  });

  it("存在但不可读 = 错误态(entries null),不误判为可首建", async () => {
    mocks.fsReadFile.mockImplementation(async (p: string) => {
      if (p === JSON_PATH) throw new Error("EACCES");
      throw new Error("ENOENT");
    });
    /* 目录清单证实文件存在 → error 而非 missing(防误覆写闸)。 */
    mocks.fsCollectFiles.mockImplementation(async (dir: string) =>
      dir === `${HOME}/.omp/agent` ? [{ name: "mcp.json" }] : [],
    );
    await refreshHub();
    const engine = getHubEngines()[0];
    expect(engine.entries).toBeNull();
    expect(engine.error).toContain("EACCES");
  });
});

describe("upsertServer 写回安全(JSON 家)", () => {
  it("先落 .bak-tmd 再写盘;未知顶层键与既有 server 保留", async () => {
    mocks.fsReadFile.mockResolvedValue(CLAUDE_LIKE);
    await refreshHub();
    const engine = getHubEngines()[0];
    await upsertServer(engine, "b", { type: "http", url: "https://x/mcp" });

    expect(mocks.fsWriteFile).toHaveBeenCalledTimes(2);
    const [bakPath, bakContent] = mocks.fsWriteFile.mock.calls[0];
    const [writePath, writeContent] = mocks.fsWriteFile.mock.calls[1];
    expect(bakPath).toBe(`${JSON_PATH}.bak-tmd`);
    expect(bakContent).toBe(CLAUDE_LIKE); // 首份备份永远是最初原样
    expect(writePath).toBe(JSON_PATH);
    const written = JSON.parse(writeContent as string);
    expect(written.other).toEqual({ keep: true }); // 未知顶层键保留
    expect(Object.keys(written.mcpServers)).toEqual(["a", "b"]); // 既有 server 不丢
  });
});

describe("TOML 家缺失拒写", () => {
  it("config.toml 不存在 = remove/upsert 抛错且零写盘", async () => {
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    const hidden = {
      profileId: "codex",
      name: "codex",
      format: "toml" as const,
      path: TOML_PATH,
      exists: false,
      displayPath: "~/.codex/config.toml",
      entries: {},
    };
    await expect(upsertServer(hidden, "x", { command: "y" })).rejects.toThrow("已拒写");
    await expect(removeServer(hidden, "x")).rejects.toThrow("已拒写");
    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
  });
});
