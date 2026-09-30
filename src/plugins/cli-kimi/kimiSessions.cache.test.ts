/**
 * listKimiSessions(modern home)state.json 解析缓存行为契约:mtime 命中免读 /
 * 变更仅重读该文件 / collect 消失剪除 / 坏 JSON 不缓存。重扫 IO 主项 = 每工作区
 * 200 个 state.json 读,缓存把它收敛为 1 次 collect + 仅新/变文件读;池按 path
 * 全局共享,多工作区并发扫同一目录的重复读直接消失。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { listKimiSessions } from "./kimiSessions";

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsListDir: vi.fn(),
  fsCollectFiles: vi.fn(),
  fsReadFile: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: { configHomeDir: mocks.configHomeDir, fsListDir: mocks.fsListDir, fsCollectFiles: mocks.fsCollectFiles, fsReadFile: mocks.fsReadFile },
}));

const STATE = (cwd: string, title = "标题甲") => JSON.stringify({ id: "session_abc123", cwd, title, createdAt: 1700000000000, archived: false });
let seq = 0;
/* 唯一目录隔离模块级缓存(stateCache 跨测试共池)。 */
const stamp = (mtime: number) => ({ name: "state.json", path: `/home/.kimi-code/sessions/wd_w-${++seq}/session_abc123/state.json`, modifiedAt: mtime });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configHomeDir.mockResolvedValue("/home");
  mocks.fsListDir.mockResolvedValue([]); /* modern home 存在 */
});

describe("listKimiSessions state 缓存", () => {
  it("mtime 未变:二次扫描零读,会话照常", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadFile.mockResolvedValue(STATE("/ws"));
    const first = await listKimiSessions("/ws");
    expect(first.map((s) => s.title)).toEqual(["标题甲"]);
    expect(mocks.fsReadFile).toHaveBeenCalledTimes(1);
    mocks.fsReadFile.mockClear();
    const second = await listKimiSessions("/ws");
    expect(second.map((s) => s.title)).toEqual(["标题甲"]);
    expect(mocks.fsReadFile).not.toHaveBeenCalled();
  });

  it("mtime 变化:仅重读该文件,标题取到新值(缓存自然失效语义)", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadFile.mockResolvedValue(STATE("/ws", "旧标题"));
    await listKimiSessions("/ws");
    mocks.fsReadFile.mockClear();
    mocks.fsCollectFiles.mockResolvedValue([{ ...f, modifiedAt: 2000 }]);
    mocks.fsReadFile.mockResolvedValue(STATE("/ws", "新标题"));
    const rows = await listKimiSessions("/ws");
    expect(mocks.fsReadFile).toHaveBeenCalledTimes(1);
    expect(rows[0].title).toBe("新标题");
  });

  it("collect 已消失的 state:缓存剪除,同路径同 mtime 再现会重读", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadFile.mockResolvedValue(STATE("/ws"));
    await listKimiSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([]);
    await listKimiSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadFile.mockClear();
    mocks.fsReadFile.mockResolvedValue(STATE("/ws"));
    await listKimiSessions("/ws");
    expect(mocks.fsReadFile).toHaveBeenCalledTimes(1);
  });

  it("坏 JSON/归档/cwd 不匹配:不缓存或被过滤,下轮重读不误判", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadFile.mockResolvedValue("not json");
    expect(await listKimiSessions("/ws")).toEqual([]);
    mocks.fsReadFile.mockResolvedValue(STATE("/other"));
    expect(await listKimiSessions("/ws")).toEqual([]);
    expect(mocks.fsReadFile).toHaveBeenCalledTimes(2); /* 坏 JSON 不缓存 → 重读 */
    mocks.fsReadFile.mockClear();
    mocks.fsReadFile.mockResolvedValue(STATE("/other"));
    await listKimiSessions("/ws");
    expect(mocks.fsReadFile).not.toHaveBeenCalled(); /* 解析成功的异 cwd 条目入缓存复用 */
  });
});
