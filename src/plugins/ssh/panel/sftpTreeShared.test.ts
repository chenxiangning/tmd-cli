/**
 * SftpTree 共享原语行为契约测试(自 state.test.ts 拆出以满足单文件 300 行铁则)。
 * 覆盖:远端路径工具 parentPath(上级推导/根/无分隔符回落 .)、joinRemote(相对直拼/
 * 根补斜杠/斜杠连接)、basenameOf(posix 与 windows 分隔符混用);
 * 下载/上传传输动作:取消选择零副作用、目录与文件的本地落点拼接、成功后刷新回调、
 * 失败弹错误提示且不误触回调。
 * 依赖 @kernel/ipc(对话框/ipc.sftpTransfer)与 window.alert,均为最小桩。
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { Mock } from "vitest";
type SharedModule = typeof import("./sftpTreeShared");

const ipcMock = { sftpTransfer: vi.fn() };
const pickDir = vi.fn();
const pickFile = vi.fn();

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock, pickDirectory: pickDir, pickFile }));
vi.mock("@kernel/i18n", () => ({
  /* 保留 {name} 插值语义即可,词典查表不属本测契约 */
  t: (key: string, params?: Record<string, string | number>) =>
    params ? key.replace(/\{(\w+)\}/g, (_, n: string) => String(params[n])) : key,
}));

let shared: SharedModule;
let alert: Mock;

const sftpNode = (path: string, name: string, kind: "dir" | "file") => ({
  path, name, kind, expanded: false, loading: false,
});

beforeEach(async () => {
  vi.resetModules();
  /* 动态 import 例外:与仓内单例测试同范式;此处主要对齐 state.test.ts 的装配方式 */
  shared = await import("./sftpTreeShared");
  ipcMock.sftpTransfer.mockReset().mockResolvedValue(undefined);
  pickDir.mockReset().mockResolvedValue(null);
  pickFile.mockReset().mockResolvedValue(null);
  alert = vi.fn();
  vi.stubGlobal("window", { alert });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("远端路径工具", () => {
  it("parentPath:上级目录推导,根归根,无分隔符回落 .", () => {
    expect(shared.parentPath("/a/b")).toBe("/a");
    expect(shared.parentPath("/a")).toBe("/");
    expect(shared.parentPath("/")).toBe("/");
    expect(shared.parentPath("name")).toBe(".");
    expect(shared.parentPath("a/b/c")).toBe("a/b");
  });

  it("joinRemote:相对目录直拼,根补斜杠,其余斜杠连接", () => {
    expect(shared.joinRemote(".", "x")).toBe("x");
    expect(shared.joinRemote("", "x")).toBe("x");
    expect(shared.joinRemote("/", "x")).toBe("/x");
    expect(shared.joinRemote("/srv", "x")).toBe("/srv/x");
  });

  it("basenameOf:posix 与 windows 分隔符混用均取末段", () => {
    expect(shared.basenameOf("/a/b/c.txt")).toBe("c.txt");
    expect(shared.basenameOf("C:\\data\\a.zip")).toBe("a.zip");
    expect(shared.basenameOf("name")).toBe("name");
  });
});

describe("下载动作 downloadNode", () => {
  it("取消选择目录则不发起传输", async () => {
    await shared.downloadNode("s1", sftpNode("/srv/d", "d", "dir"), true);
    expect(ipcMock.sftpTransfer).not.toHaveBeenCalled();
  });

  it("目录下到所选目录,文件落到所选目录下按名存放", async () => {
    pickDir.mockResolvedValue("/local");
    await shared.downloadNode("s1", sftpNode("/srv/d", "d", "dir"), true);
    expect(ipcMock.sftpTransfer).toHaveBeenCalledWith("s1", "download", "/srv/d", "/local", true);
    ipcMock.sftpTransfer.mockClear();
    await shared.downloadNode("s1", sftpNode("/srv/a.txt", "a.txt", "file"), false);
    expect(ipcMock.sftpTransfer).toHaveBeenCalledWith("s1", "download", "/srv/a.txt", "/local/a.txt", false);
  });

  it("传输失败弹错误提示且含原始消息", async () => {
    pickDir.mockResolvedValue("/local");
    ipcMock.sftpTransfer.mockRejectedValue(new Error("perm denied"));
    await shared.downloadNode("s1", sftpNode("/srv/d", "d", "dir"), false);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0]?.[0])).toContain("perm denied");
  });
});

describe("上传动作 uploadPicked", () => {
  it("取消选择文件则不动传输不回调", async () => {
    const onMutate = vi.fn();
    await shared.uploadPicked("s1", onMutate);
    expect(ipcMock.sftpTransfer).not.toHaveBeenCalled();
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("按原名上传到 remoteDir 下,成功后回调刷新;默认相对目录直拼", async () => {
    pickFile.mockResolvedValue("/local/报告 v2.zip");
    const onMutate = vi.fn();
    await shared.uploadPicked("s1", onMutate, "/srv/data");
    expect(ipcMock.sftpTransfer).toHaveBeenCalledWith(
      "s1", "upload", "/local/报告 v2.zip", "/srv/data/报告 v2.zip", false,
    );
    expect(onMutate).toHaveBeenCalledTimes(1);
    ipcMock.sftpTransfer.mockClear();
    await shared.uploadPicked("s1", onMutate);
    expect(ipcMock.sftpTransfer).toHaveBeenCalledWith(
      "s1", "upload", "/local/报告 v2.zip", "报告 v2.zip", false,
    );
  });

  it("上传失败不触发刷新回调,弹错误提示", async () => {
    pickFile.mockResolvedValue("/local/a.bin");
    ipcMock.sftpTransfer.mockRejectedValue(new Error("disk full"));
    const onMutate = vi.fn();
    await shared.uploadPicked("s1", onMutate);
    expect(onMutate).not.toHaveBeenCalled();
    expect(String(alert.mock.calls[0]?.[0])).toContain("disk full");
  });
});
