/**
 * 本地插件信任闸与扫描记录(localPluginScan)契约测试。
 * 覆盖契约:
 * - trustToken 双令牌拼接(manifest 缺失用空串占位)与 isContentTrusted 双绑定判定
 *   (信任按「内容 hash + manifest hash」不按插件名,contentHash null 一票否决)。
 * - entryNameOf 入口名回落(显式入口原样,缺失/空串/非法回落 index.js)。
 * - scanToRecord:正常条目产出完整记录;扫描错误条目原样落记录不误读 manifest;
 *   manifest 校验失败(内置 id 冲突)落错误;入口文件缺失报「入口缺失」;
 *   activateError 按「内容未变才继承」传递,activatedHash 无条件透传。
 * - activatable 可激活判定:过信任闸 + 未被拔 + 无错误 + 有内容戳,任一不满足即 false。
 * - markActivated 唯一落点:activatedHash 定格为当前 contentHash 并清激活错误;未知 id 无副作用。
 * 仅 mock settings(getSettingsState 依赖面);localPluginLoad / localPluginStore 用真件。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalPluginScanEntry } from "./ipc";

const h = vi.hoisted(() => ({
  settings: {
    localPluginTrust: {} as Record<string, string[]>,
    disabledPlugins: [] as string[],
  },
}));

vi.mock("./settings", () => ({
  getSettingsState: () => ({ settings: h.settings }),
}));

import {
  activatable,
  entryNameOf,
  isContentTrusted,
  markActivated,
  scanToRecord,
  trustToken,
} from "./localPluginScan";
import { records, __resetLocalPluginStoreForTests } from "./localPluginStore";

const BUILTIN_NONE = new Set<string>([]);

function mkStamp(name: string, sha256: string) {
  return { name, sha256, size: 10, modified_ms: 1 };
}

function mkEntry(id: string, over: Partial<LocalPluginScanEntry> = {}): LocalPluginScanEntry {
  return {
    id,
    manifest: { id, name: id, category: "feature", apiVersion: 2, version: "1.0.0" },
    files: [mkStamp("index.js", `sha-${id}`)],
    versions: [],
    ...over,
  };
}

/** 可激活基线:登记该插件的信任令牌(按记录实际 contentHash/manifestHash)。 */
function trustedRec(id: string) {
  const rec = scanToRecord(mkEntry(id), BUILTIN_NONE);
  h.settings.localPluginTrust[id] = [trustToken(rec.contentHash!, rec.manifestHash)];
  return rec;
}

beforeEach(() => {
  h.settings.localPluginTrust = {};
  h.settings.disabledPlugins = [];
  __resetLocalPluginStoreForTests();
});

describe("trustToken / isContentTrusted 信任闸", () => {
  it("双令牌拼接;manifest 缺失用空串占位", () => {
    expect(trustToken("sha-a", "m1")).toBe("sha-a:m1");
    expect(trustToken("sha-a", null)).toBe("sha-a:");
  });

  it("按内容 + manifest 双绑定放行,任一半不对即拒", () => {
    h.settings.localPluginTrust["p"] = [trustToken("sha-a", "m1")];
    expect(isContentTrusted("p", "sha-a", "m1")).toBe(true);
    expect(isContentTrusted("p", "sha-a", "m2")).toBe(false);
    expect(isContentTrusted("p", "sha-b", "m1")).toBe(false);
    expect(isContentTrusted("other", "sha-a", "m1")).toBe(false);
  });

  it("contentHash null 一票否决;信任绑定内容不绑定名字", () => {
    h.settings.localPluginTrust["p"] = [trustToken("sha-a", "m1")];
    expect(isContentTrusted("p", null, "m1")).toBe(false);
    /* 同一内容换 id 登记:内容令牌一致即认(信任按内容)。 */
    h.settings.localPluginTrust["q"] = [trustToken("sha-a", "m1")];
    expect(isContentTrusted("q", "sha-a", "m1")).toBe(true);
  });
});

describe("entryNameOf 入口名回落", () => {
  it("显式入口原样返回;缺失/空串/非字符串回落 index.js", () => {
    expect(entryNameOf({ entry: "main.js" })).toBe("main.js");
    expect(entryNameOf({})).toBe("index.js");
    expect(entryNameOf({ entry: "" })).toBe("index.js");
    expect(entryNameOf({ entry: 42 })).toBe("index.js");
  });
});

describe("scanToRecord 扫描条目 → 记录", () => {
  it("正常条目产出完整记录:哈希、权限过滤合成、meta 合成、versions 透传", () => {
    const entry = mkEntry("p1", {
      manifest: {
        id: "p1",
        name: "插件一",
        desc: "描述",
        category: "feature",
        apiVersion: 2,
        version: "1.0.0",
        permissions: ["ipc.fs.read", "settings.read"],
      },
      versions: [mkStamp("v1.js", "sha-v1")],
    });
    const rec = scanToRecord(entry, BUILTIN_NONE);
    expect(rec).toMatchObject({
      id: "p1",
      origin: "local",
      contentHash: "sha-p1",
      manifestHash: null,
      permissions: ["ipc.fs.read", "settings.read"],
      error: null,
      activateError: null,
      activatedHash: null,
      removed: false,
    });
    expect(rec.meta).toMatchObject({ name: "插件一", desc: "描述", category: "feature" });
    expect(rec.versions).toEqual([mkStamp("v1.js", "sha-v1")]);
  });

  it("扫描错误条目:错误原样落记录,manifest 缺失不误读", () => {
    const rec = scanToRecord(
      { id: "p-broken", files: [], versions: [], error: "plugin.json 非法 JSON" },
      BUILTIN_NONE,
    );
    expect(rec.error).toBe("plugin.json 非法 JSON");
    expect(rec.manifest).toBeNull();
    expect(rec.meta).toBeNull();
    expect(rec.contentHash).toBeNull();
    expect(rec.permissions).toBeNull();
  });

  it("manifest 校验失败:与内置 id 冲突落错误记录", () => {
    const rec = scanToRecord(mkEntry("git"), new Set(["git"]));
    expect(rec.error).toContain("内置");
  });

  it("入口文件缺失:报入口缺失,不产 contentHash", () => {
    const rec = scanToRecord(mkEntry("p1", { files: [] }), BUILTIN_NONE);
    expect(rec.error).toContain("入口缺失");
    expect(rec.contentHash).toBeNull();
  });

  it("自定义入口:contentHash 取对应文件的戳", () => {
    const entry = mkEntry("p1", {
      manifest: { id: "p1", name: "p1", category: "feature", apiVersion: 2, entry: "main.js" },
      files: [mkStamp("main.js", "sha-main")],
    });
    const rec = scanToRecord(entry, BUILTIN_NONE);
    expect(rec.contentHash).toBe("sha-main");
    expect(rec.error).toBeNull();
  });

  it("activateError 同内容继承、内容变更丢弃;activatedHash 无条件透传", () => {
    records.set("p1", {
      id: "p1",
      origin: "local",
      manifest: null,
      meta: null,
      contentHash: "sha-p1",
      manifestHash: null,
      permissions: null,
      versions: [],
      error: null,
      activateError: "上次激活炸了",
      activatedHash: "sha-old",
      removed: false,
    });
    /* 内容没变:激活错误继承(同内容不能靠重扫洗白失败),已激活戳透传。 */
    const same = scanToRecord(mkEntry("p1"), BUILTIN_NONE);
    expect(same.activateError).toBe("上次激活炸了");
    expect(same.activatedHash).toBe("sha-old");
    /* 内容变了:旧激活错误过时即弃,但「已激活(旧内容)」戳仍在。 */
    const afterChange = scanToRecord(
      mkEntry("p1", { files: [mkStamp("index.js", "sha-new")] }),
      BUILTIN_NONE,
    );
    expect(afterChange.activateError).toBeNull();
    expect(afterChange.activatedHash).toBe("sha-old");
  });
});

describe("activatable 可激活判定", () => {
  it("过信任闸 + 未被拔 + 无错误 + 有内容戳 = 可激活", () => {
    expect(activatable(trustedRec("p1"))).toBe(true);
  });

  it("未信任 / 被拔 / 有错误 / 无内容戳任一即不可激活;信任令牌双绑定不凑合", () => {
    /* 未信任 */
    const untrusted = scanToRecord(mkEntry("p2"), BUILTIN_NONE);
    expect(activatable(untrusted)).toBe(false);
    /* 被拔 */
    h.settings.disabledPlugins = ["p1"];
    expect(activatable(trustedRec("p1"))).toBe(false);
    h.settings.disabledPlugins = [];
    /* 有错误 */
    const bad = scanToRecord(mkEntry("p3"), new Set(["p3"]));
    expect(activatable(bad)).toBe(false);
    /* 无内容戳(manifest 缺失) */
    const noHash = scanToRecord(
      { id: "p4", files: [], versions: [] },
      BUILTIN_NONE,
    );
    expect(noHash.contentHash).toBeNull();
    expect(activatable(noHash)).toBe(false);
    /* 信任登记了 (content, null) 但记录带 manifestHash:令牌不匹配不放行 */
    const withManifest = mkEntry("p5", {
      files: [mkStamp("index.js", "sha-p5"), mkStamp("manifest.json", "sha-m5")],
    });
    h.settings.localPluginTrust["p5"] = [trustToken("sha-p5", null)];
    expect(activatable(scanToRecord(withManifest, BUILTIN_NONE))).toBe(false);
  });
});

describe("markActivated 唯一落点", () => {
  it("activatedHash 定格为当前 contentHash 并清激活错误;未知 id 无副作用", () => {
    const rec = trustedRec("p1");
    records.set("p1", rec); // markActivated 作用于状态表,记录须先落表(扫描本身不写表)
    rec.activateError = "之前炸过";
    markActivated("p1");
    expect(rec.activatedHash).toBe(rec.contentHash);
    expect(rec.activateError).toBeNull();
    expect(() => markActivated("ghost")).not.toThrow();
  });
});
