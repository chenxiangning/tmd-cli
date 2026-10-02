/**
 * omp 扩展目录与已装清单解析契约测试。
 * 覆盖:npm 搜索响应解析(防御)、合并去重排序(排除官方包/描述补全/
 * 精选标记补全与置顶豁免 cap)、`omp plugin list --json` 实证形态解析、
 * registry 单包描述兜底(缓存)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@kernel/ipc";
import {
  fetchPkgDescription,
  mergeCatalog,
  parseNpmSearch,
  parseOmpPluginList,
  type ExtCatalogEntry,
} from "./catalog";

/* fetchPkgDescription 走 ipc.quotaFetch;其余用例不触网。 */
vi.mock("@kernel/ipc", () => ({
  ipc: { quotaFetch: vi.fn() },
}));

const quotaFetch = vi.mocked(ipc.quotaFetch);

afterEach(() => {
  quotaFetch.mockReset();
});

describe("fetchPkgDescription", () => {
  it("scoped 包转义取描述;命中缓存后不再发第二次", async () => {
    quotaFetch.mockResolvedValue({
      status: 200,
      body: { name: "@scope/pkg", description: "A test pkg" },
    });
    const desc = await fetchPkgDescription("@scope/pkg");
    expect(desc).toBe("A test pkg");
    expect(quotaFetch).toHaveBeenCalledTimes(1);
    const url = quotaFetch.mock.calls[0][0].url as string;
    expect(url).toContain("registry.npmjs.org/@scope%2Fpkg");
    // 缓存命中
    await fetchPkgDescription("@scope/pkg");
    expect(quotaFetch).toHaveBeenCalledTimes(1);
  });

  it("请求失败回空串,且失败也入缓存", async () => {
    quotaFetch.mockRejectedValue(new Error("network down"));
    expect(await fetchPkgDescription("pkg-net-fail")).toBe("");
    expect(await fetchPkgDescription("pkg-net-fail")).toBe("");
    expect(quotaFetch).toHaveBeenCalledTimes(1);
  });
});


/** 对齐 registry.npmjs.org/-/v1/search 实测响应形状(2026-09-06 抓取)。 */
const REAL_SEARCH_BODY = {
  objects: [
    {
      package: {
        name: "omp-kiro",
        version: "1.2.6",
        description: "Kiro OAuth, credits usage, model discovery",
        links: { homepage: "https://example.com/kiro", npm: "https://www.npmjs.com/package/omp-kiro" },
      },
      downloads: { weekly: 1759 },
    },
    {
      package: {
        name: "pi-lens",
        version: "4.1.3",
        description: "Real-time code feedback for pi",
        links: { npm: "https://www.npmjs.com/package/pi-lens" },
      },
      downloads: { weekly: 5230 },
    },
    { package: { description: "无名包跳过" }, downloads: { weekly: 99 } },
    {
      package: {
        name: "@oh-my-pi/pi-coding-agent",
        version: "18.1.11",
        description: "引擎本体应被排除",
      },
      downloads: { weekly: 99_999 },
    },
    { package: { name: "no-download-pkg", version: "0.1.0" } },
  ],
};

describe("parseNpmSearch", () => {
  it("实测形态:解析条目、homepage 回退 npm 链接、缺 downloads 回 0", () => {
    const entries = parseNpmSearch(REAL_SEARCH_BODY);
    expect(entries.map((e) => e.name)).toEqual([
      "omp-kiro",
      "pi-lens",
      // parse 只做形状映射;官方包排除是 mergeCatalog 的语义(见 merge 测试)
      "@oh-my-pi/pi-coding-agent",
      "no-download-pkg",
    ]);
    expect(entries[0]).toMatchObject({
      version: "1.2.6",
      weeklyDownloads: 1759,
      homepage: "https://example.com/kiro",
    });
    expect(entries[1].homepage).toBe("https://www.npmjs.com/package/pi-lens");
    expect(entries[3].weeklyDownloads).toBe(0);
  });

  it("形状漂移/空响应 → 空数组不抛错", () => {
    expect(parseNpmSearch(null)).toEqual([]);
    expect(parseNpmSearch({})).toEqual([]);
    expect(parseNpmSearch({ objects: "dirty" })).toEqual([]);
  });
});

describe("mergeCatalog", () => {
  const live: ExtCatalogEntry[] = [
    { name: "a-pkg", version: "1.0.0", description: "", weeklyDownloads: 100, homepage: null },
    { name: "b-pkg", version: "2.0.0", description: "desc-b", weeklyDownloads: 500, homepage: null },
  ];
  const other: ExtCatalogEntry[] = [
    { name: "a-pkg", version: "1.0.0", description: "补全 a 描述", weeklyDownloads: 100, homepage: "https://a.example" },
    { name: "c-pkg", version: "0.3.0", description: "desc-c", weeklyDownloads: 300, homepage: null },
    { name: "@oh-my-pi/pi-coding-agent", description: "官方包", weeklyDownloads: 1, homepage: null },
  ];

  it("去重补缺 + 排除官方包 + 周下载降序", () => {
    const merged = mergeCatalog([live, other]);
    expect(merged.map((e) => e.name)).toEqual(["b-pkg", "c-pkg", "a-pkg"]);
    expect(merged[2].description).toBe("补全 a 描述");
    expect(merged[2].homepage).toBe("https://a.example");
    expect(merged[0].description).toBe("desc-b");
  });

  it("cap 截断", () => {
    const many: ExtCatalogEntry[][] = [
      Array.from({ length: 30 }, (_, i) => ({
        name: `pkg-${i}`,
        description: "",
        weeklyDownloads: i,
        homepage: null,
      })),
    ];
    expect(mergeCatalog(many)).toHaveLength(20);
    expect(mergeCatalog(many, 5)).toHaveLength(5);
  });

  it("精选条目豁免 cap 截断且置顶(零下载不因排序沉底丢失)", () => {
    const hot: ExtCatalogEntry[] = Array.from({ length: 25 }, (_, i) => ({
      name: `hot-${i}`,
      description: "",
      weeklyDownloads: 1000 - i,
      homepage: null,
    }));
    const curated: ExtCatalogEntry[] = [
      { name: "pick-a", description: "精选 A", weeklyDownloads: 0, homepage: null, curated: true },
      { name: "pick-b", description: "精选 B", weeklyDownloads: 0, homepage: null, curated: true },
    ];
    const merged = mergeCatalog([hot, curated]);
    // 20 热门 + 2 精选(豁免不计入 cap),总量 22
    expect(merged).toHaveLength(22);
    // 精选在场且置顶,组内保持静态表原序
    expect(merged.slice(0, 2).map((e) => e.name)).toEqual(["pick-a", "pick-b"]);
    // 热门组仍按周下载降序,截断只吃尾部(hot-24 被截)
    expect(merged.slice(2, 4).map((e) => e.name)).toEqual(["hot-0", "hot-1"]);
    expect(merged.some((e) => e.name === "hot-24")).toBe(false);
  });

  it("live 先到的精选包名:静态表末位补 curated 标记(描述仍先到者优先)", () => {
    const live: ExtCatalogEntry[] = [
      {
        name: "pi-lens",
        version: "4.1.3",
        description: "live desc",
        weeklyDownloads: 5230,
        homepage: null,
      },
    ];
    const curated: ExtCatalogEntry[] = [
      {
        name: "pi-lens",
        description: "静态中文描述",
        weeklyDownloads: 0,
        homepage: null,
        curated: true,
      },
    ];
    const merged = mergeCatalog([live, curated]);
    expect(merged).toHaveLength(1);
    expect(merged[0].curated).toBe(true);
    expect(merged[0].description).toBe("live desc");
  });
});

describe("parseOmpPluginList", () => {
  it("实证形态:npm 数组 + manifest 结构 + enabled 布尔", () => {
    const body = {
      npm: [
        {
          name: "@cortexkit/pi-magic-context",
          version: "0.41.3",
          path: "/tmp/x",
          manifest: { extensions: ["./dist/index.js"], version: "0.41.3" },
          enabledFeatures: null,
          enabled: true,
        },
        {
          name: "pi-background-tasks",
          version: "2.5.0",
          manifest: { version: "2.5.0" },
          enabledFeatures: null,
          enabled: false,
        },
      ],
      marketplace: [],
    };
    expect(parseOmpPluginList(body)).toEqual([
      { name: "@cortexkit/pi-magic-context", version: "0.41.3", enabled: true },
      { name: "pi-background-tasks", version: "2.5.0", enabled: false },
    ]);
  });

  it("version 字段缺失回退 manifest.version", () => {
    const body = {
      npm: [{ name: "pkg-x", manifest: { version: "9.9.9" }, enabled: true }],
    };
    expect(parseOmpPluginList(body)[0].version).toBe("9.9.9");
  });

  it("形状漂移(缺 npm 数组)抛错,不猜测兜底", () => {
    expect(() => parseOmpPluginList({})).toThrow();
    expect(() => parseOmpPluginList(null)).toThrow();
    expect(() => parseOmpPluginList({ npm: "dirty" })).toThrow();
  });
});
