/**
 * scanJsonlSessions 读头缓存行为契约(mtime 命中免读头 / 变更重读 / 消失剪除 /
 * 空结果不缓存 / 深窗兜底结果同样入缓存)。重扫 IO 主项 = 每文件读头,缓存把
 * 「会话每开/关一次全库重扫 N 读头」收敛为 1 次 fs_collect_files + 仅新/变文件读头。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanJsonlSessions } from "./diskSessions";

const mocks = vi.hoisted(() => ({
  fsCollectFiles: vi.fn(),
  fsReadHead: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({ ipc: { fsCollectFiles: mocks.fsCollectFiles, fsReadHead: mocks.fsReadHead } }));

const UUID = "0d03dfef-6824-4a05-b32e-a738c8a48d03";
const NAME = `2026-09-18T00-00-00-000Z_${UUID}.jsonl`;
const DEEP = 256 * 1024;
let seq = 0;

/** 唯一目录隔离模块级缓存;stamp 造 FileStamp,head 造一条带标题的 user 消息行。 */
const mkDir = () => `/tmp/tmd-cache-test/dir-${++seq}`;
const stamp = (dir: string, mtime: number, name = NAME) => ({ name, path: `${dir}/${name}`, modifiedAt: mtime });
const headLine = (title: string) => `${JSON.stringify({ type: "message", message: { role: "user", content: title } })}\n`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scanJsonlSessions 读头缓存", () => {
  it("mtime 未变:二次扫描零读头,标题照常", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    mocks.fsReadHead.mockResolvedValue(headLine("标题甲"));
    const first = await scanJsonlSessions(dir);
    expect(first.map((s) => s.title)).toEqual(["标题甲"]);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(1);
    mocks.fsReadHead.mockClear();
    const second = await scanJsonlSessions(dir);
    expect(second.map((s) => s.title)).toEqual(["标题甲"]);
    expect(mocks.fsReadHead).not.toHaveBeenCalled();
  });

  it("mtime 变化:仅重读该文件,其余走缓存", async () => {
    const dir = mkDir();
    const other = stamp(dir, 1000, `2026-09-18T00-00-00-000Z_11111111-2222-4333-8444-555555555555.jsonl`);
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000), other]);
    mocks.fsReadHead.mockResolvedValue(headLine("标题乙"));
    await scanJsonlSessions(dir);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(2);
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 2000), other]);
    mocks.fsReadHead.mockClear();
    await scanJsonlSessions(dir);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(1);
    expect(mocks.fsReadHead.mock.calls[0][0]).toBe(`${dir}/${NAME}`);
  });

  it("文件消失:缓存条目剪除,同路径同 mtime 再现会重读", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    mocks.fsReadHead.mockResolvedValue(headLine("标题丙"));
    await scanJsonlSessions(dir);
    mocks.fsCollectFiles.mockResolvedValue([]);
    await scanJsonlSessions(dir);
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    mocks.fsReadHead.mockClear();
    await scanJsonlSessions(dir);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(1);
  });

  it("读头无标题:不缓存,下轮重读追赶自动命名", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    mocks.fsReadHead.mockResolvedValue("not json garbage\n");
    await scanJsonlSessions(dir);
    mocks.fsReadHead.mockClear();
    await scanJsonlSessions(dir);
    /* 浅窗 miss 后还有深窗兜底,一轮 = 2 读;关键是不落缓存 */
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(2);
  });

  it("浅窗缺标题走深窗兜底:解析结果同样入缓存", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    mocks.fsReadHead.mockImplementation(async (_p: string, bytes: number) =>
      bytes >= DEEP ? headLine("深窗标题") : "",
    );
    const first = await scanJsonlSessions(dir);
    expect(first.map((s) => s.title)).toEqual(["深窗标题"]);
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(2); // 浅窗 miss + 深窗命中
    mocks.fsReadHead.mockClear();
    const second = await scanJsonlSessions(dir);
    expect(second.map((s) => s.title)).toEqual(["深窗标题"]);
    expect(mocks.fsReadHead).not.toHaveBeenCalled();
  });
});
