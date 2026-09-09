/**
 * 配置读写壳契约:备份只建一次、次序在主写之前;读三态
 * (ok / missing / error)区分「不存在」与「存在但不可读」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type IpcModule = typeof import("@kernel/ipc");

let ipc: IpcModule["ipc"];
let io: typeof import("./io");

/** 内存 FS 桩:files 为 null 的路径模拟「存在但读取抛错」。 */
function stubFs(files: Record<string, string | null>, written: string[]): void {
  (ipc as unknown as { fsReadFile: unknown }).fsReadFile = (path: string) =>
    files[path] === null
      ? Promise.reject(new Error("EACCES"))
      : path in files
        ? Promise.resolve(files[path])
        : Promise.reject(new Error("ENOENT"));
  (ipc as unknown as { fsWriteFile: unknown }).fsWriteFile = (path: string, content: string) => {
    written.push(path);
    files[path] = content;
    return Promise.resolve(null);
  };
  (ipc as unknown as { fsCollectFiles: unknown }).fsCollectFiles = (dir: string) =>
    Promise.resolve(
      Object.entries(files)
        .filter(([p]) => p.startsWith(`${dir}/`))
        .map(([p]) => ({ name: p.slice(dir.length + 1), path: p, mtime: 0 })),
    );
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块连带 kernel/ipc 模块级单例,须借 resetModules 重置
  const ipcMod = await import("@kernel/ipc");
  ipc = ipcMod.ipc;
  io = await import("./io");
  io.resetBackupsForTest();
});

describe("readConfig 三态", () => {
  it("存在可读 = ok", async () => {
    stubFs({ "/a.yml": "k: v" }, []);
    expect(await io.readConfig("/a.yml")).toEqual({ kind: "ok", text: "k: v" });
  });

  it("文件不存在 = missing(父目录可列出但不含该名)", async () => {
    stubFs({ "/a.yml": "k: v" }, []);
    expect(await io.readConfig("/b.yml")).toEqual({ kind: "missing" });
  });

  it("存在但读取抛错 = error(父目录清单里有它)", async () => {
    stubFs({ "/a.yml": null }, []);
    const r = await io.readConfig("/a.yml");
    expect(r.kind).toBe("error");
  });
});

describe("writeConfigFile 备份", () => {
  it("首写建 .bak-tmd 且先于主写;再写不滚存", async () => {
    const files: Record<string, string | null> = { "/a.yml": "original" };
    const written: string[] = [];
    stubFs(files, written);
    await io.writeConfigFile("/a.yml", "v1");
    await io.writeConfigFile("/a.yml", "v2");
    expect(written).toEqual(["/a.yml.bak-tmd", "/a.yml", "/a.yml"]);
    expect(files["/a.yml.bak-tmd"]).toBe("original");
    expect(files["/a.yml"]).toBe("v2");
  });

  it("目标不存在不建备份,直接写", async () => {
    const files: Record<string, string | null> = {};
    const written: string[] = [];
    stubFs(files, written);
    await io.writeConfigFile("/new.yml", "content");
    expect(written).toEqual(["/new.yml"]);
  });

  it("备份写失败不阻塞主写(降级为无备份)", async () => {
    const files: Record<string, string | null> = { "/a.yml": "original" };
    const written: string[] = [];
    stubFs(files, written);
    (ipc as unknown as { fsWriteFile: unknown }).fsWriteFile = (path: string, content: string) => {
      if (path.endsWith(".bak-tmd")) return Promise.reject(new Error("read-only"));
      written.push(path);
      files[path] = content;
      return Promise.resolve(null);
    };
    await io.writeConfigFile("/a.yml", "v1");
    expect(written).toEqual(["/a.yml"]);
    expect(files["/a.yml"]).toBe("v1");
  });
});
