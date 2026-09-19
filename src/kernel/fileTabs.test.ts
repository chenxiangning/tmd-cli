/**
 * fileTabs 契约(跨插件「打开文件」唯一入口,fileTabs.ts):
 * openFileInTab —— id/path/payload 一律 normalizePath 派生(反斜杠→正斜杠、
 *   剥尾分隔符),kind 恒 "file",title = 归一路径末段;
 *   同文件不同分隔符写法(树点击 `\` vs 搜索拼 `/`)去重为单 tab 且激活;
 *   不写待定位行(takeFileRevealLine 不得命中)。
 * openFileAtLine —— 先写「归一路径 → 行号」待定位项,再以 refresh 语义重开:
 *   已开 tab 不产生第二个 tab(刷新激活);同文件重复调用行号覆盖为最新。
 * takeFileRevealLine —— 一次性消费:命中返回 1 基行号并清除(再取为 null);
 *   键与写入方同源(同一 normalizePath 派生,反斜杠/正斜杠互通);无待定位返回 null。
 *
 * fileTabs 与 tabs 均为模块级单例:vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// 类型仅作形状声明(编译期擦除,不产生运行时依赖);运行时实例必须走下方
// 动态 import —— fileTabs(定位行表)与 tabs(tab store)是模块级单例,
// 需 vi.resetModules + 动态 import 取全新实例(terminalLinks.test.ts 同款例外)。
type FileTabsModule = typeof import("./fileTabs");
type TabsModule = typeof import("./tabs");

let fileTabs: FileTabsModule;
let tabs: TabsModule;

beforeEach(async () => {
  vi.resetModules();
  fileTabs = await import("./fileTabs");
  tabs = await import("./tabs");
});

describe("openFileInTab", () => {
  it("建 tab:id/kind/path/payload 按归一路径派生,title 取末段", () => {
    fileTabs.openFileInTab("C:\\repo\\src\\main.rs");
    expect(tabs.getTabs()).toHaveLength(1);
    const tab = tabs.getTabs()[0];
    expect(tab.id).toBe("file:C:/repo/src/main.rs");
    expect(tab.kind).toBe("file");
    expect(tab.path).toBe("C:/repo/src/main.rs");
    expect(tab.payload).toEqual({ path: "C:/repo/src/main.rs" });
    expect(tab.title).toBe("main.rs");
    expect(tabs.getActiveTabId()).toBe("file:C:/repo/src/main.rs");
  });

  it("同文件不同分隔符写法去重为单 tab:反斜杠打开后再用正斜杠打开不新增", () => {
    fileTabs.openFileInTab("C:\\repo\\src\\a.ts");
    fileTabs.openFileInTab("C:/repo/src/a.ts");
    expect(tabs.getTabs()).toHaveLength(1);
    expect(tabs.getActiveTabId()).toBe("file:C:/repo/src/a.ts");
  });

  it("尾部分隔符剥除:带尾斜杠的路径与不带者同一 tab", () => {
    fileTabs.openFileInTab("repo/src/lib/");
    fileTabs.openFileInTab("repo/src/lib");
    expect(tabs.getTabs()).toHaveLength(1);
    expect(tabs.getTabs()[0].id).toBe("file:repo/src/lib");
  });

  it("不写待定位行:打开后 takeFileRevealLine 返回 null", () => {
    fileTabs.openFileInTab("src/a.ts");
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBeNull();
  });
});

describe("openFileAtLine", () => {
  it("写定位行并开 tab;已开 tab 重开不产生第二个 tab(refresh 激活)", () => {
    fileTabs.openFileInTab("src/a.ts");
    fileTabs.openFileAtLine("src/a.ts", 42);
    expect(tabs.getTabs()).toHaveLength(1);
    expect(tabs.getActiveTabId()).toBe("file:src/a.ts");
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBe(42);
  });

  it("重复定位同一文件:新行号覆盖旧行号(每次取到的都是最新)", () => {
    fileTabs.openFileAtLine("src/a.ts", 10);
    fileTabs.openFileAtLine("src/a.ts", 99);
    expect(tabs.getTabs()).toHaveLength(1);
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBe(99);
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBeNull();
  });

  it("定位键与查询键分隔符同源对齐:反斜杠写入、正斜杠消费命中", () => {
    fileTabs.openFileAtLine("C:\\repo\\src\\b.ts", 7);
    expect(fileTabs.takeFileRevealLine("C:/repo/src/b.ts")).toBe(7);
  });

  it("不同文件定位互不串扰:各取各的行号,互不影响", () => {
    fileTabs.openFileAtLine("src/a.ts", 1);
    fileTabs.openFileAtLine("src/b.ts", 2);
    expect(fileTabs.takeFileRevealLine("src/b.ts")).toBe(2);
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBe(1);
  });
});

describe("takeFileRevealLine", () => {
  it("一次性消费:命中即清除,二次取为 null", () => {
    fileTabs.openFileAtLine("src/a.ts", 5);
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBe(5);
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBeNull();
  });

  it("无待定位返回 null;消费后不残留对后续打开的影响", () => {
    expect(fileTabs.takeFileRevealLine("src/never.ts")).toBeNull();
    fileTabs.openFileAtLine("src/a.ts", 3);
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBe(3);
    // 消费后再开同一文件,定位行已清空
    fileTabs.openFileInTab("src/a.ts");
    expect(fileTabs.takeFileRevealLine("src/a.ts")).toBeNull();
  });
});
