/**
 * terminalPathLinks 契约(终端裸路径可点击):
 * find 正则矩阵 —— 绝对(POSIX/~ /盘符/UNC)/相对/:line/:line:col/空格路径;
 * 反例 —— URL(://)排除、无分隔符裸词、版本号样散文;
 * resolvePath/openPathHit —— root 拼接(POSIX/Windows)、~/ 经 configHomeDir 展开、
 * .. 消除、不存在静默(fsReadTail 拒绝)、col 忽略只跳行。
 * 手法:kernel 依赖(workspace/fileTabs/ipc/host)以 vi.mock 顶替。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openFileAtLine: vi.fn(),
  getActiveWorkspace: vi.fn(),
  fsReadTail: vi.fn(),
  configHomeDir: vi.fn(),
  getActiveSessionId: vi.fn(),
  getSessions: vi.fn(),
}));
vi.mock("@kernel/fileTabs", () => ({ openFileAtLine: mocks.openFileAtLine }));
vi.mock("@kernel/workspace", () => ({ getActiveWorkspace: mocks.getActiveWorkspace }));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsReadTail: mocks.fsReadTail,
    configHomeDir: mocks.configHomeDir,
  },
}));
vi.mock("@kernel/host", () => ({
  host: {
    getActiveSessionId: mocks.getActiveSessionId,
    getSessions: mocks.getSessions,
  },
}));

import { filePathLinkProvider, parsePathHit, resolvePath } from "./terminalPathLinks";

const ROOT = "/repo";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveWorkspace.mockReturnValue({ root: ROOT });
  mocks.getActiveSessionId.mockReturnValue("pty-1");
  mocks.getSessions.mockReturnValue([{ id: "pty-1", profileId: "omp", cwd: "/repo" }]);
  mocks.fsReadTail.mockResolvedValue("");
  mocks.configHomeDir.mockResolvedValue("/home/x");
});

/** 取首命中文本。 */
const hitText = (line: string) => {
  const hits = filePathLinkProvider.find(line);
  return hits.length ? line.slice(hits[0].start, hits[0].end) : null;
};

describe("PATH_RE 矩阵", () => {
  it("绝对 POSIX / 盘符 / UNC / ~ 各形态命中", () => {
    expect(hitText("打开 /repo/src/a.ts:12:3 看看")).toBe("/repo/src/a.ts:12:3");
    expect(hitText("改 C:\\repo\\a.md:4")).toBe("C:\\repo\\a.md:4");
    expect(hitText("读 \\\\srv\\share\\b.ts:1")).toBe("\\\\srv\\share\\b.ts:1");
    expect(hitText("看 ~/notes/a.md:2")).toBe("~/notes/a.md:2");
  });

  it("相对路径(./ ../ 带目录)与无行号形态命中", () => {
    expect(hitText("见 src/app.ts:5")).toBe("src/app.ts:5");
    expect(hitText("见 ./src/app.ts")).toBe("./src/app.ts");
    expect(hitText("见 ../sib/x.rs")).toBe("../sib/x.rs");
    expect(hitText("打开 src/deep/mod.rs")).toBe("src/deep/mod.rs");
  });

  it("URL 显式排除(://),http/https 整链不出命中", () => {
    expect(filePathLinkProvider.find("见 https://a.com/x.ts:5")).toEqual([]);
    expect(filePathLinkProvider.find("见 http://a.com/b/c")).toEqual([]);
  });

  it("空格路径须含分隔符:带分隔符命中,散文不吃进", () => {
    expect(hitText("打开 /My Dir/file.ts 啊")).toBe("/My Dir/file.ts");
    expect(hitText("见 src/app.ts and a.rs 两文件")).toBe("src/app.ts");
  });

  it("无扩展名反例:裸词/版本号/纯目录名散文不出命中", () => {
    expect(filePathLinkProvider.find("see now")).toEqual([]);
    expect(filePathLinkProvider.find("version 1.2.3 released")).toEqual([]);
  });

  it("行号区间:命中只覆盖自身,:line:col 整体成链", () => {
    const line = "改 src/app.ts:12:3 与 src/b.ts:7";
    const hits = filePathLinkProvider.find(line);
    expect(hits).toHaveLength(2);
    expect(line.slice(hits[0].start, hits[0].end)).toBe("src/app.ts:12:3");
    expect(line.slice(hits[1].start, hits[1].end)).toBe("src/b.ts:7");
  });

  it("多文件同行各自成链:空格续段合链按头段完整尾切割", () => {
    const line = "M src/kernel/a.ts src/plugins/b.ts done";
    const hits = filePathLinkProvider.find(line);
    expect(hits.map((h) => line.slice(h.start, h.end))).toEqual(["src/kernel/a.ts", "src/plugins/b.ts"]);
  });

  it("diff 头两侧路径独立成链(+++ 不进链)", () => {
    const line = "--- a/src/app.ts +++ b/src/app.ts";
    const hits = filePathLinkProvider.find(line);
    expect(hits.map((h) => line.slice(h.start, h.end))).toEqual(["a/src/app.ts", "b/src/app.ts"]);
  });

  it("三连文件逐个分割不漏", () => {
    const line = "Edit src/a.ts src/b.ts src/c.ts end";
    const hits = filePathLinkProvider.find(line);
    expect(hits.map((h) => line.slice(h.start, h.end))).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("真空格目录路径不受切割:头段无扩展名尾保持整链", () => {
    expect(hitText("打开 /My Dir/file.ts 啊")).toBe("/My Dir/file.ts");
    expect(hitText("看 /repo/Notes 2024/a.md:2 后续")).toBe("/repo/Notes 2024/a.md:2");
  });

  it("逗号分隔多文件各自成链:带空格 / 无空格 / 行尾逗号", () => {
    const spaced = "改 src/a.ts, src/b.ts 两个文件";
    expect(filePathLinkProvider.find(spaced).map((h) => spaced.slice(h.start, h.end))).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    const tight = "改 src/a.ts,src/b.ts 两个文件";
    expect(filePathLinkProvider.find(tight).map((h) => tight.slice(h.start, h.end))).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    const trailing = "改 src/a.ts, src/b.ts,";
    expect(filePathLinkProvider.find(trailing).map((h) => trailing.slice(h.start, h.end))).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("逗号反例:无分隔符裸词不出命中,路径中部逗号不误切保持整链", () => {
    expect(filePathLinkProvider.find("a.ts, b.ts")).toEqual([]);
    expect(hitText("见 (docs/a,b.ts) 说明")).toBe("docs/a,b.ts");
  });
});

describe("parsePathHit", () => {
  it("剥 :line / :line:col,col 忽略只跳行;无行号默认 1", () => {
    expect(parsePathHit("a/b.ts:12:3")).toEqual({ path: "a/b.ts", line: 12 });
    expect(parsePathHit("a/b.ts:12")).toEqual({ path: "a/b.ts", line: 12 });
    expect(parsePathHit("/x/a.ts")).toEqual({ path: "/x/a.ts", line: 1 });
  });
});

describe("resolvePath(路径归一与展开)", () => {
  it("绝对路径归一命中,区外同样返回绝对路径(不限工作区)", async () => {
    await expect(resolvePath("/repo/src/a.ts", ROOT)).resolves.toBe("/repo/src/a.ts");
    await expect(resolvePath("/etc/passwd", ROOT)).resolves.toBe("/etc/passwd");
    await expect(resolvePath("C:\\repo\\a.md", "C:\\repo")).resolves.toBe("C:/repo/a.md");
  });

  it("相对路径按激活会话 spawn cwd 拼,.. 消除", async () => {
    await expect(resolvePath("src/app.ts", ROOT)).resolves.toBe("/repo/src/app.ts");
    mocks.getSessions.mockReturnValue([{ id: "pty-1", profileId: "omp", cwd: "/repo/sub" }]);
    await expect(resolvePath("../x.ts", ROOT)).resolves.toBe("/repo/x.ts");
  });

  it("Windows cwd + 相对路径:盘符段不加前导 /,拼出 C:/ 形态", async () => {
    mocks.getSessions.mockReturnValue([{ id: "pty-1", profileId: "omp", cwd: "C:\\repo" }]);
    await expect(resolvePath("src/app.ts", "C:\\repo")).resolves.toBe("C:/repo/src/app.ts");
    await expect(resolvePath("..\\sib\\x.ts", "C:\\repo")).resolves.toBe("C:/sib/x.ts");
  });

  it("~/ 经 configHomeDir 展开", async () => {
    await expect(resolvePath("~/repo/notes.md", "/home/x")).resolves.toBe("/home/x/repo/notes.md");
    await expect(resolvePath("~/other/notes.md", ROOT)).resolves.toBe("/home/x/other/notes.md");
  });
});

describe("provider.open", () => {
  it("root 内存在:fsReadTail 探测后开 tab 跳行;col 只跳行", async () => {
    const line = "改 src/app.ts:12:3";
    filePathLinkProvider.open(filePathLinkProvider.find(line)[0], line);
    await vi.waitFor(() => expect(mocks.openFileAtLine).toHaveBeenCalledWith("/repo/src/app.ts", 12));
  });

  it("绝对路径在 root 内:原路径直开", async () => {
    const line = "看 /repo/docs/a.md:7";
    filePathLinkProvider.open(filePathLinkProvider.find(line)[0], line);
    await vi.waitFor(() => expect(mocks.openFileAtLine).toHaveBeenCalledWith("/repo/docs/a.md", 7));
  });

  it("不存在静默不开 tab;区外存在照样开", async () => {
    mocks.fsReadTail.mockRejectedValue(new Error("missing"));
    const missing = "看 src/nope.ts:1";
    filePathLinkProvider.open(filePathLinkProvider.find(missing)[0], missing);
    await vi.waitFor(() => expect(mocks.fsReadTail).toHaveBeenCalledTimes(1));
    expect(mocks.openFileAtLine).not.toHaveBeenCalled();

    mocks.fsReadTail.mockResolvedValue("");
    const outside = "看 /etc/passwd:1";
    filePathLinkProvider.open(filePathLinkProvider.find(outside)[0], outside);
    await vi.waitFor(() => expect(mocks.openFileAtLine).toHaveBeenCalledWith("/etc/passwd", 1));
  });

  it("无激活工作区静默", () => {
    mocks.getActiveWorkspace.mockReturnValue(undefined);
    const line = "改 src/app.ts:5";
    filePathLinkProvider.open(filePathLinkProvider.find(line)[0], line);
    expect(mocks.fsReadTail).not.toHaveBeenCalled();
  });
});
