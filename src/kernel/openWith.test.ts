/**
 * 打开方式跨插件契约纯函数测试 —— kernel/openWith:
 * 预设目录平台过滤、默认项解析(失效回落)、预设/自定义条目构造、副行文案。
 * ipc 仅被图标 hook 触达,这里 mock 掉避免拉入 Tauri 通道。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  fsOpenAppIcon: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

import {
  OPEN_WITH_PRESET_CATALOG,
  customOpenWithTarget,
  openWithExt,
  openWithSubtitle,
  openWithTargetFromPreset,
  rememberOpenWithDefault,
  resolveDefaultOpenWith,
  resolveDefaultOpenWithFor,
} from "./openWith";
import type { OpenWithTarget } from "./settingsTypes";

/* 极简 localStorage stub(node 环境无 Web Storage),见 filePanel.test.ts 先例。 */
const storageBack = new Map<string, string>();
vi.stubGlobal(
  "localStorage",
  {
    getItem: (k: string) => storageBack.get(k) ?? null,
    setItem: (k: string, v: string) => void storageBack.set(k, v),
    removeItem: (k: string) => void storageBack.delete(k),
  } as Storage,
);
afterEach(() => storageBack.clear());

beforeEach(() => {
  ipcMock.fsOpenAppIcon.mockReset();
  ipcMock.fsOpenAppIcon.mockResolvedValue(null);
});

describe("OPEN_WITH_PRESET_CATALOG", () => {
  it("预设 id 唯一,finder 恒在三平台", () => {
    const ids = OPEN_WITH_PRESET_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const platform of ["macos", "windows", "linux"] as const) {
      expect(
        OPEN_WITH_PRESET_CATALOG.some((p) => p.id === "finder" && p.platforms.includes(platform)),
      ).toBe(true);
    }
  });

  it("平台过滤:ghostty 不进 windows,notepad/windows-terminal 只进 windows", () => {
    const idsFor = (platform: string) =>
      OPEN_WITH_PRESET_CATALOG.filter((p) => p.platforms.includes(platform as never)).map((p) => p.id);
    expect(idsFor("macos")).not.toContain("notepad");
    expect(idsFor("windows")).not.toContain("ghostty");
    expect(idsFor("windows")).toContain("windows-terminal");
    expect(idsFor("windows")).toContain("notepad");
  });
});

describe("resolveDefaultOpenWith", () => {
  const targets: OpenWithTarget[] = [
    { id: "finder", label: "访达", kind: "finder" },
    { id: "vscode", label: "VS Code", kind: "app", appName: "Visual Studio Code" },
  ];

  it("空清单返回 null(入口隐藏)", () => {
    expect(resolveDefaultOpenWith([], "finder")).toBeNull();
  });

  it("defaultId 命中返回该条", () => {
    expect(resolveDefaultOpenWith(targets, "vscode")?.id).toBe("vscode");
  });

  it("defaultId 失效(被删)回落首项", () => {
    expect(resolveDefaultOpenWith(targets, "gone")?.id).toBe("finder");
  });
});

describe("按扩展名记忆默认(openWithExt / rememberOpenWithDefault / resolveDefaultOpenWithFor)", () => {
  const targets: OpenWithTarget[] = [
    { id: "finder", label: "访达", kind: "finder" },
    { id: "vscode", label: "VS Code", kind: "app", appName: "Visual Studio Code" },
    { id: "cursor", label: "Cursor", kind: "app", appName: "Cursor" },
  ];

  it("openWithExt:大小写归一、双分隔符、末段取扩展", () => {
    expect(openWithExt("/a/b/main.PY")).toBe("py");
    expect(openWithExt("C:\\x\\y.md")).toBe("md");
    expect(openWithExt("dir.d/file")).toBeNull(); // 点在目录段,basename 无扩展
    expect(openWithExt("/x/.gitignore")).toBeNull(); // 首点隐藏文件不算扩展
    expect(openWithExt("README")).toBeNull();
  });

  it("记忆命中优先于全局默认;大小写不同的同扩展共享记忆", () => {
    rememberOpenWithDefault("/p/a.py", "cursor");
    expect(resolveDefaultOpenWithFor(targets, "vscode", "/q/B.PY")?.id).toBe("cursor");
  });

  it("未记忆/无扩展名回落全局默认;记忆的目标被删同样回落", () => {
    expect(resolveDefaultOpenWithFor(targets, "vscode", "/p/a.ts")?.id).toBe("vscode");
    expect(resolveDefaultOpenWithFor(targets, "vscode", "/p/Makefile")?.id).toBe("vscode");
    rememberOpenWithDefault("/p/a.py", "gone");
    expect(resolveDefaultOpenWithFor(targets, "vscode", "/p/a.py")?.id).toBe("vscode");
  });

  it("存储损坏(非对象 JSON)静默当无记忆", () => {
    storageBack.set("tmd.openWith.extDefault.v1", "[1,2]");
    expect(resolveDefaultOpenWithFor(targets, "vscode", "/p/a.py")?.id).toBe("vscode");
  });
});

describe("条目构造", () => {
  it("openWithTargetFromPreset 携带启动字段、不带平台标注", () => {
    const preset = OPEN_WITH_PRESET_CATALOG.find((p) => p.id === "vscode")!;
    expect(openWithTargetFromPreset(preset)).toEqual({
      id: "vscode",
      label: "VS Code",
      kind: "app",
      appName: "Visual Studio Code",
    });
  });

  it("customOpenWithTarget:label 取文件名剥 .app,id 带 custom- 前缀", () => {
    const t = customOpenWithTarget("/Applications/Sublime Text.app");
    expect(t.label).toBe("Sublime Text");
    expect(t.kind).toBe("app");
    expect(t.appName).toBe("/Applications/Sublime Text.app");
    expect(t.id.startsWith("custom-")).toBe(true);
  });
});

describe("openWithSubtitle", () => {
  it("app/command/finder 三态", () => {
    expect(openWithSubtitle({ id: "v", label: "VS Code", kind: "app", appName: "Visual Studio Code" })).toContain(
      "Visual Studio Code",
    );
    expect(openWithSubtitle({ id: "w", label: "WT", kind: "command", command: "wt.exe" })).toContain("wt.exe");
    expect(openWithSubtitle({ id: "f", label: "访达", kind: "finder" })).toContain("访达");
  });
});
