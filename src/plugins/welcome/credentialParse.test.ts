/**
 * 凭据容错解析 / 引擎版本收藏 / 单引擎探针契约测试(并入同目录小模块
 * versionFavs.ts、engineProbe.ts)。
 * 覆盖契约:
 * - parseJsonLoose:磁盘截断/损坏/空/非对象字面量一律 null,绝不裸抛
 * - parseCredentialData:omp auth row → 三字段投影;空白串拒收、两侧行空白 trim、
 *   畸形 JSON/缺字段回落 undefined
 * - versionFavKey 拼接;listVersionFavs 按引擎前缀过滤 + semver 降序
 * - toggleVersionFav:未收藏新增 / 已收藏取消,其余引擎收藏保留,同 key 不重
 * - probeEngine:found→ok / !found→notFound / 抛错→error(result null)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({ cliProbe: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

const settingsMock = vi.hoisted(() => {
  const state = { settings: { engineVersionFavs: {} as Record<string, { favedAt: number }> } };
  return {
    state,
    getSettingsState: vi.fn(() => state),
    /* 与真实 kernel settings 同语义:补丁就地并入状态,后续读可见 */
    updateSettings: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(state.settings, patch);
    }),
  };
});
vi.mock("@kernel/settings", () => settingsMock);

import { parseJsonLoose, parseCredentialData } from "./credentialParse";
import { versionFavKey, listVersionFavs, toggleVersionFav } from "./versionFavs";
import { probeEngine } from "./engineProbe";

beforeEach(() => {
  settingsMock.state.settings.engineVersionFavs = {};
  settingsMock.updateSettings.mockClear();
  ipcMock.cliProbe.mockReset();
});

describe("parseJsonLoose", () => {
  it("合法 JSON 对象原样解析;截断/损坏 JSON → null 不裸抛", () => {
    expect(parseJsonLoose('{"key":"a"}')).toEqual({ key: "a" });
    expect(parseJsonLoose('{"key":"a"')).toBeNull();
    expect(parseJsonLoose("not json")).toBeNull();
  });

  it("空串 / null 短路 → null", () => {
    expect(parseJsonLoose("")).toBeNull();
    expect(parseJsonLoose(null)).toBeNull();
  });

  it("解析为非对象字面量(数字/字符串/布尔/null)→ null", () => {
    expect(parseJsonLoose("42")).toBeNull();
    expect(parseJsonLoose('"str"')).toBeNull();
    expect(parseJsonLoose("true")).toBeNull();
    expect(parseJsonLoose("null")).toBeNull();
  });
});

describe("parseCredentialData", () => {
  it("全字段齐全 → 三字段投影;两侧行空白 trim", () => {
    expect(
      parseCredentialData(JSON.stringify({ key: "  k1  ", access: "a1", accountId: "acc1" })),
    ).toEqual({ key: "k1", access: "a1", accountId: "acc1" });
  });

  it("纯空白值拒收为 undefined;字段缺失 / 非字符串类型回落 undefined", () => {
    expect(parseCredentialData(JSON.stringify({ key: "   ", access: 42, accountId: null }))).toEqual(
      { key: undefined, access: undefined, accountId: undefined },
    );
    expect(parseCredentialData(JSON.stringify({}))).toEqual({});
  });

  it("畸形 JSON → 空投影(不裸抛,凭据区不静默消失)", () => {
    expect(parseCredentialData("{broken")).toEqual({});
  });
});

describe("versionFavKey + listVersionFavs", () => {
  it("key = engineId@version 扁平拼接", () => {
    expect(versionFavKey("omp", "1.2.3")).toBe("omp@1.2.3");
  });

  it("按引擎前缀过滤:其他引擎与无 @ 撞名 key 不混入", () => {
    const favs = {
      "omp@1.0.0": { favedAt: 1 },
      "codex@2.0.0": { favedAt: 2 },
      "omp2@9.9.9": { favedAt: 3 },
    };
    expect(listVersionFavs(favs, "omp")).toEqual(["1.0.0"]);
    expect(listVersionFavs({}, "omp")).toEqual([]);
  });

  it("同引擎多版本按 semver 降序(数值比较非字典序)", () => {
    const favs = {
      "omp@1.2.3": { favedAt: 1 },
      "omp@1.10.0": { favedAt: 2 },
      "omp@1.2.10": { favedAt: 3 },
    };
    expect(listVersionFavs(favs, "omp")).toEqual(["1.10.0", "1.2.10", "1.2.3"]);
  });
});

describe("toggleVersionFav", () => {
  it("未收藏 → 新增(带 favedAt),其他引擎收藏原样保留", () => {
    settingsMock.state.settings.engineVersionFavs = { "codex@2.0.0": { favedAt: 1 } };

    toggleVersionFav("omp", "1.2.3");

    const favs = settingsMock.updateSettings.mock.calls[0][0].engineVersionFavs as Record<string, { favedAt: number }>;
    expect(favs).toBeTruthy();
    expect(Object.keys(favs).sort()).toEqual(["codex@2.0.0", "omp@1.2.3"]);
    expect(typeof favs["omp@1.2.3"].favedAt).toBe("number");
  });

  it("已收藏 → 取消;再切换恢复(同 key 往返不重不残留)", () => {
    settingsMock.state.settings.engineVersionFavs = {
      "omp@1.2.3": { favedAt: 1 },
      "codex@2.0.0": { favedAt: 2 },
    };

    toggleVersionFav("omp", "1.2.3");
    expect(listVersionFavs(settingsMock.state.settings.engineVersionFavs, "omp")).toEqual([]);

    toggleVersionFav("omp", "1.2.3");
    const favs = settingsMock.state.settings.engineVersionFavs;
    expect(Object.keys(favs).filter((k) => k === "omp@1.2.3")).toHaveLength(1);
    expect(favs["codex@2.0.0"]).toEqual({ favedAt: 2 });
  });
});

describe("probeEngine", () => {
  it("found → ok,result 原样透传", async () => {
    const result = { command: "omp", found: true, path: "/bin/omp", version: "1.0" };
    ipcMock.cliProbe.mockResolvedValue(result);

    expect(await probeEngine("omp")).toEqual({ status: "ok", result });
    expect(ipcMock.cliProbe).toHaveBeenCalledWith("omp");
  });

  it("found:false → notFound,result 原样透传", async () => {
    const result = { command: "omp", found: false, path: null, version: null };
    ipcMock.cliProbe.mockResolvedValue(result);

    expect(await probeEngine("omp")).toEqual({ status: "notFound", result });
  });

  it("探针抛错 → error 态 + result null(拒绝值是裸字符串也兜住)", async () => {
    ipcMock.cliProbe.mockRejectedValue("E_IO: boom");

    expect(await probeEngine("omp")).toEqual({ status: "error", result: null });
  });
});
