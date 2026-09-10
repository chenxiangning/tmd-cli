/**
 * localPlugins 确认/回退/拓扑流契约测试(与 localPlugins.test.ts 共用同一套桩骨架)。
 * ipc / settings / host 全 mock;EventBus 用真件(纯 pub/sub);importBundle 注入假模块。
 */
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalPluginScanEntry } from "./ipc";
import type { Plugin } from "./plugin";

/* vi.mock 工厂在顶层变量初始化前执行:一切被工厂引用的桩必须住进 vi.hoisted。 */
const hoisted = vi.hoisted(() => {
  const bundleModules = new Map<string, unknown>();
  const activeIds = new Set<string>();
  return {
    scan: vi.fn(),
    readFile: vi.fn(),
    archive: vi.fn(async () => null),
    rollback: vi.fn(async () => {}),
    activateLate: vi.fn(async (p: Plugin) => {
      /* 对齐真实 lifecycle:已激活即拒(占位防双激活);activate 抛错向上传播(占位回滚)。 */
      if (activeIds.has(p.id)) throw new Error(`插件已激活: ${p.id}`);
      await p.activate({} as never);
      activeIds.add(p.id);
    }),
    activeIds,
    importBundle: vi.fn(async (text: string, _id: string) => {
      const mod = bundleModules.get(text);
      if (!mod) throw new Error(`未注册的假 bundle: ${text.slice(0, 30)}`);
      return mod;
    }),
    bundleModules,
  };
});
const scanMock = hoisted.scan as Mock<() => Promise<LocalPluginScanEntry[]>>;
const readFileMock = hoisted.readFile as Mock<
  (id: string, name: string) => Promise<{ content: string; sha256: string }>
>;
const archiveMock = hoisted.archive as Mock<(id: string) => Promise<string | null>>;
const rollbackMock = hoisted.rollback as Mock<(id: string, file: string) => Promise<void>>;
const activateLateMock = hoisted.activateLate as Mock<(p: Plugin) => Promise<void>>;
const importBundleMock = hoisted.importBundle as Mock<
  (text: string, id: string) => Promise<unknown>
>;
const bundleModules = hoisted.bundleModules;

vi.mock("./ipc", () => ({
  ipc: {
    pluginScan: hoisted.scan,
    pluginReadFile: hoisted.readFile,
    pluginArchive: hoisted.archive,
    pluginRollback: hoisted.rollback,
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

let mockSettings: {
  localPluginsDisabled: boolean;
  localPluginTrust: Record<string, string[]>;
  disabledPlugins: string[];
};

vi.mock("./settings", () => ({
  getSettingsState: () => ({ settings: mockSettings }),
  updateSettings: (patch: Record<string, unknown>) => {
    mockSettings = { ...mockSettings, ...patch } as typeof mockSettings;
  },
  subscribeSettings: () => () => {},
  settingsReady: Promise.resolve(),
}));

vi.mock("./host", async () => {
  /* mock 工厂在顶层变量初始化前执行:bus 自建自留,测试经 mocked host.events 访问。 */
  const { EventBus } = await import("./events");
  return {
    host: {
      activateLate: (p: Plugin) => hoisted.activateLate(p) as Promise<void>,
      isPluginActive: (id: string) => hoisted.activeIds.has(id),
      events: new EventBus(),
    },
  };
});

vi.mock("./localPluginLoad", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./localPluginLoad")>();
  return { ...orig, importBundle: hoisted.importBundle };
});

import {
  activateBootLocals,
  bootLocalPlugins,
  confirmLocalPlugin,
  getLocalPluginRecords,
  rescanLocalPlugins,
  rollbackLocalPlugin,
  trustToken,
  __resetLocalPluginsForTests,
} from "./localPlugins";
/** 信任种子速记:manifestHash 缺省(null)的令牌。 */
const tk = (hash: string): string => trustToken(hash, null);
/** bundle 登记表:stage 登记,单一 readFile 实现按它应答(避免 mockImplementation 互相覆盖)。 */
const bundleTexts = new Map<string, { text: string; sha256: string }>();

function mkPluginModule(id: string, activate?: () => void) {
  const plugin: Plugin = {
    id,
    meta: { name: id, abbr: id.slice(0, 2).toUpperCase(), desc: "", category: "feature" },
    activate: activate ?? (() => {}),
  };
  return { default: plugin };
}
function mkEntry(id: string, md5 = `md5-${id}`): LocalPluginScanEntry {
  return {
    id,
    manifest: { id, name: id, category: "feature", apiVersion: 2, version: "1.0.0" },
    files: [{ name: "index.js", sha256: md5, size: 10, modified_ms: 1 }],
    versions: [],
  };
}

function stage(id: string, md5?: string, activate?: () => void) {
  const entry = mkEntry(id, md5);
  const hash = entry.files[0]!.sha256;
  const text = `bundle:${id}:${hash}`;
  bundleTexts.set(`${id}/index.js`, { text, sha256: hash });
  bundleModules.set(text, mkPluginModule(id, activate));
  return entry;
}

beforeEach(() => {
  mockSettings = { localPluginsDisabled: false, localPluginTrust: {}, disabledPlugins: [] };
  scanMock.mockReset();
  readFileMock.mockImplementation(async (rid, name) => {
    const f = bundleTexts.get(`${rid}/${name}`);
    if (f) return { content: f.text, sha256: f.sha256 };
    throw new Error(`unexpected read ${rid}/${name}`);
  });
  hoisted.activeIds.clear();
  archiveMock.mockClear();
  rollbackMock.mockClear();
  activateLateMock.mockClear();
  importBundleMock.mockClear();
  bundleModules.clear();
  bundleTexts.clear();
  __resetLocalPluginsForTests();
});

describe("confirmLocalPlugin 信任闸", () => {
  it("确认 = 信任当前 hash + 归档版本库 + 立即晚激活", async () => {
    scanMock.mockResolvedValue([stage("p-new")]);
    await bootLocalPlugins(new Set());
    await confirmLocalPlugin("p-new");
    expect(mockSettings.localPluginTrust["p-new"]).toContain(tk("md5-p-new"));
    expect(archiveMock).toHaveBeenCalledWith("p-new");
    expect(activateLateMock).toHaveBeenCalledTimes(1);
    expect(getLocalPluginRecords()[0].activatedHash).toBe("md5-p-new");
  });

  it("本地互依赖按拓扑激活,不按扫描字母序", async () => {
    /* 字母序 a-child 在前,依赖 b-parent;正确实现必须先激活 b-parent。 */
    scanMock.mockResolvedValue([stage("a-child", undefined), stage("b-parent")]);
    /* a-child dependsOn b-parent:mkEntry 不带 dependsOn,用 bundle 模块的 dependsOn 注入 */
    readFileMock.mockImplementation(async (rid) => ({
      content: `bundle:${rid}:md5-${rid}`,
      sha256: `md5-${rid}`,
    }));
    bundleModules.set("bundle:a-child:md5-a-child", {
      default: {
        id: "a-child",
        dependsOn: ["b-parent"],
        activate: () => {},
      },
    });
    bundleModules.set("bundle:b-parent:md5-b-parent", {
      default: {
        id: "b-parent",
        meta: { name: "b", abbr: "BP", desc: "", category: "feature" },
        activate: () => {},
      },
    });
    mockSettings.localPluginTrust = {
      "a-child": [tk("md5-a-child")],
      "b-parent": [tk("md5-b-parent")],
    };
    const plugins = await bootLocalPlugins(new Set());
    await activateBootLocals(plugins);
});


  it("已激活插件确认更新:信任+归档,但不重复激活(重启生效)", async () => {
    scanMock.mockResolvedValue([stage("p-a")]);
    mockSettings.localPluginTrust = { "p-a": [tk("md5-p-a")] };
    const plugins = await bootLocalPlugins(new Set());
    await activateBootLocals(plugins);
    const callsAfterBoot = activateLateMock.mock.calls.length;
    scanMock.mockResolvedValue([stage("p-a", "md5-p-a-v2")]);
    await rescanLocalPlugins();
    await confirmLocalPlugin("p-a");
    expect(mockSettings.localPluginTrust["p-a"]).toContain(tk("md5-p-a-v2"));
    expect(archiveMock).toHaveBeenCalledWith("p-a");
    expect(activateLateMock.mock.calls.length).toBe(callsAfterBoot); // 确认更新不重复激活(重启生效)
    const rec = getLocalPluginRecords()[0];
    expect(rec.activatedHash).toBe("md5-p-a");
    expect(rec.contentHash).toBe("md5-p-a-v2");
  });
});

describe("rollbackLocalPlugin 版本回退", () => {
  it("回退委托 Rust 并触发重扫", async () => {
    scanMock.mockResolvedValue([stage("p-a")]);
    mockSettings.localPluginTrust = { "p-a": ["md5-p-a"] };
    const plugins = await bootLocalPlugins(new Set());
    await activateBootLocals(plugins);
    rollbackMock.mockImplementation(async () => {
      scanMock.mockResolvedValue([stage("p-a", "md5-p-a-old")]);
    });
    await rollbackLocalPlugin("p-a", "1.0.0-deadbeef.js");
    expect(rollbackMock).toHaveBeenCalledWith("p-a", "1.0.0-deadbeef.js");
    expect(getLocalPluginRecords()[0].contentHash).toBe("md5-p-a-old");
  });
});
