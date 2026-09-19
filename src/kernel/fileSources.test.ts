/**
 * fileSources 契约:
 * registerRemoteFileSource / findRemoteFileSource —— 按 appliesTo 匹配活动工作区,
 * 多命中取先注册者;无命中 = null(该工作区无远程浏览能力);
 * 退订即摘除,摘除后命中与 URI 判定同步失效;
 * findRemoteFileSourceForUri —— 按 ownsUri 前缀判定 URI 归属源;
 * isRemoteFileUri —— 任一已注册源认领即为 true;来源未启用恒 false。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "./ipc";
import type { Workspace } from "./workspace";

/* 动态 import 例外:sources 是模块级单例数组,静态 import 会跨用例共享注册表;
   必须 resetModules 后取全新实例(范式同 terminalLinks.test.ts) */
import type { RemoteFileSource } from "./fileSources";
let mod: typeof import("./fileSources");

beforeEach(async () => {
  vi.resetModules();
  mod = await import("./fileSources");
});

function ws(id: string): Workspace {
  return { id, name: id, root: `/tmp/${id}`, createdAt: 0 };
}

function fakeSource(id: string, ownsWs: (w: Workspace) => boolean, ownsUri: (p: string) => boolean): RemoteFileSource {
  const entries: DirEntry[] = [{ name: "a.txt", path: "a.txt", isDir: false }];
  return {
    id,
    appliesTo: ownsWs,
    label: () => "fake host",
    listDir: async () => entries,
    fileUri: (_w, p) => `${id}://${p}`,
    ownsUri,
    readText: async (uri) => `text of ${uri}`,
  };
}

describe("findRemoteFileSource(appliesTo 分派)", () => {
  it("无注册源时返回 null", () => {
    expect(mod.findRemoteFileSource(ws("w1"))).toBeNull();
  });

  it("命中唯一源;不命中的工作区返回 null", () => {
    const src = fakeSource("wslr", (w) => w.id === "remote", () => false);
    mod.registerRemoteFileSource(src);
    expect(mod.findRemoteFileSource(ws("remote"))).toBe(src);
    expect(mod.findRemoteFileSource(ws("local"))).toBeNull();
  });

  it("多源同时命中取先注册者", () => {
    const first = fakeSource("a", () => true, () => false);
    const second = fakeSource("b", () => true, () => false);
    mod.registerRemoteFileSource(first);
    mod.registerRemoteFileSource(second);
    expect(mod.findRemoteFileSource(ws("any"))).toBe(first);
  });

  it("退订后命中失效;其余源不受影响", () => {
    const unsub = mod.registerRemoteFileSource(fakeSource("a", () => true, () => false));
    const keep = fakeSource("b", () => true, () => false);
    mod.registerRemoteFileSource(keep);
    unsub();
    expect(mod.findRemoteFileSource(ws("any"))).toBe(keep);
  });
});

describe("findRemoteFileSourceForUri / isRemoteFileUri(ownsUri 分派)", () => {
  it("按前缀认领 URI 归属源;无人认领 = null", () => {
    const wslr = fakeSource("wslr", () => false, (p) => p.startsWith("wslr://"));
    mod.registerRemoteFileSource(wslr);
    expect(mod.findRemoteFileSourceForUri("wslr:///home/x")).toBe(wslr);
    expect(mod.findRemoteFileSourceForUri("ssh:///home/x")).toBeNull();
  });

  it("isRemoteFileUri:任一源认领即 true;退订后同 URI 变 false", () => {
    expect(mod.isRemoteFileUri("wslr:///x")).toBe(false);
    const unsub = mod.registerRemoteFileSource(fakeSource("wslr", () => false, (p) => p.startsWith("wslr://")));
    expect(mod.isRemoteFileUri("wslr:///x")).toBe(true);
    unsub();
    expect(mod.isRemoteFileUri("wslr:///x")).toBe(false);
  });

  it("退订单个源后,其余源认领的 URI 判定不受影响", () => {
    mod.registerRemoteFileSource(fakeSource("a", () => false, (p) => p.startsWith("a://")));
    const unsub = mod.registerRemoteFileSource(fakeSource("b", () => false, () => true));
    unsub();
    expect(mod.isRemoteFileUri("a://x")).toBe(true);
    expect(mod.isRemoteFileUri("anything")).toBe(false);
  });
});

describe("RemoteFileSource 协议面", () => {
  it("listDir / readText / fileUri 按来源自决语义透传", async () => {
    const src = fakeSource("wslr", () => true, (p) => p.startsWith("wslr://"));
    mod.registerRemoteFileSource(src);
    const found = mod.findRemoteFileSource(ws("w"));
    expect(found?.id).toBe("wslr");
    expect(found?.label(ws("w"))).toBe("fake host");
    await expect(found?.listDir(ws("w"), "/")).resolves.toEqual([
      { name: "a.txt", path: "a.txt", isDir: false },
    ]);
    expect(found?.fileUri(ws("w"), "a.txt")).toBe("wslr://a.txt");
    await expect(found?.readText("wslr://a.txt", 1024)).resolves.toBe("text of wslr://a.txt");
    expect(found?.ownsUri("wslr://a.txt")).toBe(true);
  });
});
