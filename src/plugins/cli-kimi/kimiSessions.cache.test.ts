/**
 * listKimiSessions(modern home)state.json 解析缓存行为契约:mtime 命中免读 /
 * 变更仅重读该文件 / collect 消失剪除 / 坏 JSON 不缓存。重扫 IO 主项 = 每工作区
 * 200 个 state.json 读,缓存把它收敛为 1 次 collect + 仅新/变文件读;池按 path
 * 全局共享,多工作区并发扫同一目录的重复读直接消失。
 * 批量化(2026-10-04):state 读走 fs_read_heads 批量,计数按 path 数累计。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { listKimiSessions } from "./kimiSessions";

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsListDir: vi.fn(),
  fsCollectFiles: vi.fn(),
  fsReadHeads: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: mocks.configHomeDir,
    fsListDir: mocks.fsListDir,
    fsCollectFiles: mocks.fsCollectFiles,
    fsReadHeads: mocks.fsReadHeads,
  },
}));

const STATE = (cwd: string, title = "标题甲") => JSON.stringify({ id: "session_abc123", cwd, title, createdAt: 1700000000000, archived: false });
let seq = 0;
/* 唯一目录隔离模块级缓存(stateCache 跨测试共池)。 */
const stamp = (mtime: number) => ({ name: "state.json", path: `/home/.kimi-code/sessions/wd_w-${++seq}/session_abc123/state.json`, modifiedAt: mtime });

/** 当前 state 内容单源:批量读按 path 全量回填同一文本。 */
let stateText = "";
const setStateHead = (text: string) => {
  stateText = text;
  mocks.fsReadHeads.mockImplementation(async (ps: string[]) => ps.map(() => stateText));
};
const readCount = () => mocks.fsReadHeads.mock.calls.reduce((n, c) => n + c[0].length, 0);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configHomeDir.mockResolvedValue("/home");
  mocks.fsListDir.mockResolvedValue([]); /* modern home 存在 */
});

describe("listKimiSessions state 缓存", () => {
  it("mtime 未变:二次扫描零读,会话照常", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    setStateHead(STATE("/ws"));
    const first = await listKimiSessions("/ws");
    expect(first.map((s) => s.title)).toEqual(["标题甲"]);
    expect(readCount()).toBe(1);
    mocks.fsReadHeads.mockClear();
    const second = await listKimiSessions("/ws");
    expect(second.map((s) => s.title)).toEqual(["标题甲"]);
    expect(readCount()).toBe(0);
  });

  it("mtime 变化:仅重读该文件,标题取到新值(缓存自然失效语义)", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    setStateHead(STATE("/ws", "旧标题"));
    await listKimiSessions("/ws");
    mocks.fsReadHeads.mockClear();
    mocks.fsCollectFiles.mockResolvedValue([{ ...f, modifiedAt: 2000 }]);
    setStateHead(STATE("/ws", "新标题"));
    const rows = await listKimiSessions("/ws");
    expect(readCount()).toBe(1);
    expect(rows[0].title).toBe("新标题");
  });

  it("collect 已消失的 state:缓存剪除,同路径同 mtime 再现会重读", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    setStateHead(STATE("/ws"));
    await listKimiSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([]);
    await listKimiSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadHeads.mockClear();
    setStateHead(STATE("/ws"));
    await listKimiSessions("/ws");
    expect(readCount()).toBe(1);
  });

  it("坏 JSON/归档/cwd 不匹配:不缓存或被过滤,下轮重读不误判", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    setStateHead("not json");
    expect(await listKimiSessions("/ws")).toEqual([]);
    setStateHead(STATE("/other"));
    expect(await listKimiSessions("/ws")).toEqual([]);
    expect(readCount()).toBe(2); /* 坏 JSON 不缓存 → 重读 */
    mocks.fsReadHeads.mockClear();
    setStateHead(STATE("/other"));
    await listKimiSessions("/ws");
    expect(readCount()).toBe(0); /* 解析成功的异 cwd 条目入缓存复用 */
  });
});
