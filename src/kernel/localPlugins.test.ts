/**
 * localPlugins 装载编排契约测试(对话即变 + 信任闸 + 幂等重扫 + 故障隔离)。
 * ipc / settings / host 全 mock;EventBus 用真件(纯 pub/sub);importBundle 注入假模块。
 */
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KernelTopics } from "./events";
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

import { host } from "./host";

import {
  activateBootLocals,
  bootLocalPlugins,
  getLocalPluginRecords,
  rescanLocalPlugins,
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

describe("bootLocalPlugins 启动装载", () => {
  it("总开关开 → 不扫描不装载,零动作", async () => {
    mockSettings.localPluginsDisabled = true;
    const plugins = await bootLocalPlugins(new Set());
    expect(plugins).toEqual([]);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("未信任插件只落「待启用」记录不进激活清单;已信任插件装载并返回", async () => {
    scanMock.mockResolvedValue([stage("p-new"), stage("p-trusted")]);
    mockSettings.localPluginTrust = { "p-trusted": [tk("md5-p-trusted")] };
    const plugins = await bootLocalPlugins(new Set());
    await activateBootLocals(plugins); // 模拟 main 的晚激活阶段(activate 跑过才有「运行中」戳)
    expect(plugins.map((p) => p.id)).toEqual(["p-trusted"]);
    const records = getLocalPluginRecords();
    expect(records.find((r) => r.id === "p-new")?.activatedHash).toBeNull();
    expect(records.find((r) => r.id === "p-trusted")?.activatedHash).toBe("md5-p-trusted");
  });

  it("与内置 id 冲突 → 加载失败条目,不 import", async () => {
    scanMock.mockResolvedValue([stage("git")]);
    mockSettings.localPluginTrust = { git: [tk("md5-git")] };
    const plugins = await bootLocalPlugins(new Set(["git"]));
    expect(plugins).toEqual([]);
    expect(getLocalPluginRecords()[0].error).toContain("内置");
    expect(importBundleMock).not.toHaveBeenCalled();
  });

  it("activate 抛错被隔离:boot 不炸,失败不落「已激活」戳,修复后重扫可重试", async () => {
    let boom = true;
    scanMock.mockResolvedValue([
      stage("p-bad", undefined, () => {
        if (boom) throw new Error("activate 炸了");
      }),
      stage("p-good"),
    ]);
    mockSettings.localPluginTrust = { "p-bad": [tk("md5-p-bad")], "p-good": [tk("md5-p-good")] };
    const plugins = await bootLocalPlugins(new Set());
    expect(plugins.map((p) => p.id)).toEqual(["p-bad", "p-good"]);
    /* 拓扑晚激活单插件失败隔离:错误落记录,不落 activatedHash,其余插件照常 */
    await activateBootLocals(plugins);
    const bad = getLocalPluginRecords().find((r) => r.id === "p-bad");
    expect(bad?.activateError).toContain("炸了");
    expect(bad?.activatedHash).toBeNull();
    expect(getLocalPluginRecords().find((r) => r.id === "p-good")?.activatedHash).toBe(
      "md5-p-good",
    );
    /* AI 修复(内容变化 + 重信任)后重扫:失败插件重试成功,戳落 + 旧错误清除 */
    boom = false;
    scanMock.mockResolvedValue([stage("p-bad", "md5-p-bad-v2"), stage("p-good")]);
    mockSettings.localPluginTrust = {
      "p-bad": [tk("md5-p-bad"), tk("md5-p-bad-v2")],
      "p-good": [tk("md5-p-good")],
    };
    await rescanLocalPlugins();
    const fixed = getLocalPluginRecords().find((r) => r.id === "p-bad");
    expect(fixed?.activatedHash).toBe("md5-p-bad-v2");
    expect(fixed?.activateError).toBeNull();
  });

  it("扫描戳与读回哈希不一致 → 拒装不 import(信任闸闭环,防扫描后文件被换)", async () => {
    const entry = stage("p-evil");
    scanMock.mockResolvedValue([entry]);
    mockSettings.localPluginTrust = { "p-evil": [tk("md5-p-evil")] };
    /* 读回的 sha256 与扫描戳不符:模拟扫描后入口文件被替换 */
    readFileMock.mockImplementation(async () => ({ content: "bundle:p-evil:EVIL", sha256: "evil" }));
    const plugins = await bootLocalPlugins(new Set());
    expect(plugins).toEqual([]);
    expect(importBundleMock).not.toHaveBeenCalled();
    expect(getLocalPluginRecords()[0].error).toContain("不一致");
  });

  it("boot 晚激活对已激活插件幂等(StrictMode 双跑不落假错误)", async () => {
    scanMock.mockResolvedValue([stage("p-a")]);
    mockSettings.localPluginTrust = { "p-a": [tk("md5-p-a")] };
    const plugins = await bootLocalPlugins(new Set());
    await activateBootLocals(plugins);
    await activateBootLocals(plugins); // 第二跑:isPluginActive 命中 → 补戳,不触发 activateLate
    expect(activateLateMock).toHaveBeenCalledTimes(1);
    const rec = getLocalPluginRecords().find((r) => r.id === "p-a");
    expect(rec?.activatedHash).toBe("md5-p-a");
    expect(rec?.activateError).toBeNull();
  });
  it("扫描错误条目原样落记录;被拔插件不激活", async () => {
    scanMock.mockResolvedValue([
      { id: "p-broken", files: [], versions: [], error: "plugin.json 非法 JSON" },
      stage("p-pulled"),
    ]);
    mockSettings.localPluginTrust = { "p-pulled": [tk("md5-p-pulled")] };
    mockSettings.disabledPlugins = ["p-pulled"];
    const plugins = await bootLocalPlugins(new Set());
    expect(plugins).toEqual([]);
    const records = getLocalPluginRecords();
    expect(records.find((r) => r.id === "p-broken")?.error).toContain("非法 JSON");
    expect(records.find((r) => r.id === "p-pulled")?.activatedHash).toBeNull();
  });
});

describe("rescanLocalPlugins 重扫", () => {
  it("幂等:同内容重扫零 import 零激活", async () => {
    scanMock.mockResolvedValue([stage("p-a")]);
    mockSettings.localPluginTrust = { "p-a": [tk("md5-p-a")] };
    const plugins = await bootLocalPlugins(new Set());
    await activateBootLocals(plugins);
    const imports = importBundleMock.mock.calls.length;
    await rescanLocalPlugins();
    expect(importBundleMock.mock.calls.length).toBe(imports);
  });

  it("单飞:并发重扫只跑一次扫描", async () => {
    /* 可控闸门:扫描挂起期间并发触发三次重扫,放行后只应见到一次扫描。 */
    const gate = Promise.withResolvers<LocalPluginScanEntry[]>();
    scanMock.mockImplementation(() => gate.promise);
    const pending = [rescanLocalPlugins(), rescanLocalPlugins(), rescanLocalPlugins()];
    gate.resolve([]);
    await Promise.all(pending);
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("对话即变:turnSettled 触发自动重扫,已信任新插件免重启激活", async () => {
    scanMock.mockResolvedValue([]);
    await bootLocalPlugins(new Set());
    scanMock.mockResolvedValue([stage("p-late")]);
    mockSettings.localPluginTrust = { "p-late": [tk("md5-p-late")] };
    host.events.emit(KernelTopics.turnSettled, { sessionId: "s", unviewed: false, settledAt: 0 });
    /* 自动重扫经单飞闸复用同一 Promise:直接 await 一次 rescan 即等其收尾。 */
    await rescanLocalPlugins();
    expect(activateLateMock).toHaveBeenCalledTimes(1);
    expect(activateLateMock.mock.calls[0][0].id).toBe("p-late");
  });

  it("已激活插件内容变更:只换徽章不重新激活", async () => {
    scanMock.mockResolvedValue([stage("p-a")]);
    mockSettings.localPluginTrust = { "p-a": [tk("md5-p-a")] };
    const plugins = await bootLocalPlugins(new Set());
    await activateBootLocals(plugins);
    const callsAfterBoot = activateLateMock.mock.calls.length;
    scanMock.mockResolvedValue([stage("p-a", "md5-p-a-v2")]);
    mockSettings.localPluginTrust = { "p-a": [tk("md5-p-a"), tk("md5-p-a-v2")] };
    await rescanLocalPlugins();
    const rec = getLocalPluginRecords().find((r) => r.id === "p-a");
    expect(rec?.contentHash).toBe("md5-p-a-v2");
    expect(rec?.activatedHash).toBe("md5-p-a"); // 已激活的仍是旧内容,重启生效
    expect(activateLateMock.mock.calls.length).toBe(callsAfterBoot); // 不重复激活
  });
});
