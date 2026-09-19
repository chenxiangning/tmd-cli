/**
 * terminalLink 契约(marks 终端回链提供者):
 * openAndReveal 双通道 —— kernel 深链 openFileAtLine(原路径,line) +
 * marks 扩展 requestReveal(normalizePath 后路径,line);
 * provider.find 透传 parseMarkRef:path:L起-L止 与单行号两种形态,含字符区间
 * (识别端与发送端 serializeMark 的格式同步契约,识别逻辑真身不在此重测);
 * provider.open —— 相对引用拼激活工作区 root;POSIX/Windows 盘符/UNC 绝对
 * 引用不拼 root;无激活工作区或区间无引用时静默不动作。
 * 手法:kernel 依赖(fileTabs/workspace)与 marks store 以 vi.mock 顶替;
 * parseMarkRef/normalizePath 用真件(纯函数)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openFileAtLine: vi.fn(),
  getActiveWorkspace: vi.fn(),
  requestReveal: vi.fn(),
}));
vi.mock("@kernel/fileTabs", () => ({ openFileAtLine: mocks.openFileAtLine }));
vi.mock("@kernel/workspace", () => ({ getActiveWorkspace: mocks.getActiveWorkspace }));
/* sendTransform 还 import setMarkState/stagedMarks(本文件不触达),一并提供空桩 */
vi.mock("./store", () => ({
  requestReveal: mocks.requestReveal,
  setMarkState: vi.fn(),
  stagedMarks: vi.fn(() => []),
}));

import { marksLinkProvider, openAndReveal } from "./terminalLink";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openAndReveal", () => {
  it("双通道:深链按原路径打开,扩展定位收 normalize 后路径", () => {
    openAndReveal("/repo/docs/a.md", 7);
    expect(mocks.openFileAtLine).toHaveBeenCalledTimes(1);
    expect(mocks.openFileAtLine).toHaveBeenCalledWith("/repo/docs/a.md", 7);
    expect(mocks.requestReveal).toHaveBeenCalledTimes(1);
    expect(mocks.requestReveal).toHaveBeenCalledWith("/repo/docs/a.md", 7);
  });
});

describe("marksLinkProvider", () => {
  it("find 透传 parseMarkRef:range 与单行号两种形态,含字符区间", () => {
    const hits = marksLinkProvider.find("见 src/app.ts:12-20 与 a.md:5");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ path: "src/app.ts", startLine: 12, endLine: 20, start: 2, end: 18 });
    expect(hits[1]).toMatchObject({ path: "a.md", startLine: 5, endLine: 5, start: 21 });
  });

  it("open:相对引用拼激活工作区 root 后双通道打开", () => {
    mocks.getActiveWorkspace.mockReturnValue({ root: "/repo" });
    const line = "看 src/app.ts:12-20";
    marksLinkProvider.open(marksLinkProvider.find(line)[0], line);
    expect(mocks.openFileAtLine).toHaveBeenCalledWith("/repo/src/app.ts", 12);
    expect(mocks.requestReveal).toHaveBeenCalledWith("/repo/src/app.ts", 12);
  });

  it("open:绝对引用(POSIX/Windows 盘符/UNC)不拼 root", () => {
    mocks.getActiveWorkspace.mockReturnValue({ root: "/repo" });

    const posix = "/tmp/x.ts:3";
    marksLinkProvider.open({ start: 0, end: posix.length }, posix);
    expect(mocks.openFileAtLine).toHaveBeenLastCalledWith("/tmp/x.ts", 3);

    const win = "C:\\repo\\a.md:4";
    marksLinkProvider.open({ start: 0, end: win.length }, win);
    expect(mocks.openFileAtLine).toHaveBeenLastCalledWith("C:\\repo\\a.md", 4);
    expect(mocks.requestReveal).toHaveBeenLastCalledWith("C:/repo/a.md", 4);

    const unc = "\\\\srv\\share\\b.ts:1";
    marksLinkProvider.open({ start: 0, end: unc.length }, unc);
    expect(mocks.openFileAtLine).toHaveBeenLastCalledWith(unc.slice(0, -2), 1);
  });

  it("open:无激活工作区静默;区间无引用静默", () => {
    mocks.getActiveWorkspace.mockReturnValue(undefined);
    const ref = "/tmp/x.ts:3";
    marksLinkProvider.open({ start: 0, end: ref.length }, ref);
    expect(mocks.openFileAtLine).not.toHaveBeenCalled();
    expect(mocks.requestReveal).not.toHaveBeenCalled();

    marksLinkProvider.open({ start: 0, end: 6 }, "纯文本无引用");
    expect(mocks.openFileAtLine).not.toHaveBeenCalled();
  });
});
