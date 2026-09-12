/**
 * updateCheck 单元测试 —— 守住三个可观察契约:
 * 1. parseChangelog:Keep a Changelog 三层结构(## 版本 → ### 小节 → - 条目),
 *    导语/空行/底部链接引用不入结果,顺序保持书写序(最新在前);
 * 2. isNewerVersion:数值比较(0.10.0 > 0.9.0),容 v 前缀,不可解析不误报;
 * 3. fetchLatestRelease:GitHub releases/latest 映射;非 200 / 缺字段 / 网络
 *    失败一律 null 静默,绝不抛错。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHANGELOG_ENTRIES,
  checkLatestRelease,
  extractSemver,
  isNewerVersion,
  parseAtomLatest,
  parseChangelog,
} from "./updateCheck";

const quotaFetch = vi.hoisted(() =>
  vi.fn<() => Promise<{ status: number; body: unknown }>>(async () => {
    throw new Error("network down");
  }),
);
vi.mock("@kernel/ipc", () => ({
  ipc: { quotaFetch: (...args: unknown[]) => quotaFetch(...(args as [])) },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  quotaFetch.mockReset();
  quotaFetch.mockImplementation(async () => {
    throw new Error("network down");
  });
});

describe("extractSemver", () => {
  it.each([
    ["v0.2.0", "0.2.0"],
    ["0.1.0", "0.1.0"],
    ["  v10.20.30  ", "10.20.30"],
  ])("从 tag %s 抠出 %s", (raw, expected) => {
    expect(extractSemver(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["v1.2"], ["abc"], ["1.2.3.4"]] as const)(
    "不合法输入 %s → null",
    (raw) => {
      expect(extractSemver(raw)).toBeNull();
    },
  );
});

describe("isNewerVersion", () => {
  it("补丁位落后 → true", () => {
    expect(isNewerVersion("v0.1.1", "0.1.0")).toBe(true);
  });

  it("数值比较:0.10.0 > 0.9.0(字符串比较会判反)", () => {
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
  });

  it("相等 / 更旧 → false", () => {
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.0.9", "0.1.0")).toBe(false);
  });

  it("任一不可解析 → false(不误导用户升级)", () => {
    expect(isNewerVersion("Unreleased", "0.1.0")).toBe(false);
    expect(isNewerVersion("v0.2.0", "")).toBe(false);
    expect(isNewerVersion("v0.2.0", "dev")).toBe(false);
  });
});

describe("parseChangelog", () => {
  const fixture = [
    "# 更新日志",
    "",
    "导语一段,不入结果。",
    "",
    "## [Unreleased]",
    "### 进行中",
    "- 未发布条目",
    "",
    "## [0.1.0] - 2026-09-04",
    "首个公开发布版本。", // 导语行:不入小节
    "### 新增",
    "- 功能 A",
    "- 功能 B",
    "",
    "### 修复",
    "- 缺陷 C",
    "",
    "[0.1.0]: https://github.com/chenxiangning/tmd-cli/releases/tag/v0.1.0",
  ].join("\n");

  it("解析出版本小节结构,导语与链接引用不入结果", () => {
    expect(parseChangelog(fixture)).toEqual([
      {
        version: "Unreleased",
        date: null,
        blocks: [{ heading: "进行中", items: ["未发布条目"] }],
      },
      {
        version: "0.1.0",
        date: "2026-09-04",
        blocks: [
          { heading: "新增", items: ["功能 A", "功能 B"] },
          { heading: "修复", items: ["缺陷 C"] },
        ],
      },
    ]);
  });

  it("条目前若无 ### 小节,归入无名块", () => {
    const raw = ["## [0.2.0] - 2026-09-10", "- 直接条目"].join("\n");
    expect(parseChangelog(raw)).toEqual([
      { version: "0.2.0", date: "2026-09-10", blocks: [{ heading: "", items: ["直接条目"] }] },
    ]);
  });

  it("空文件 / 无版本头 → 空数组", () => {
    expect(parseChangelog("")).toEqual([]);
    expect(parseChangelog("# 只有标题\n- 不是版本头下的条目")).toEqual([]);
  });

  it("CRLF 换行可解析", () => {
    const raw = "## [0.1.0] - 2026-09-04\r\n### 新增\r\n- 功能 A\r\n";
    expect(parseChangelog(raw)[0]?.blocks).toEqual([{ heading: "新增", items: ["功能 A"] }]);
  });
});


describe("parseAtomLatest", () => {
  /* 按真实 releases.atom 结构截取(机器生成,形状稳定)。 */
  const atom = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>Release notes from tmd-cli</title>",
    "  <entry>",
    "    <id>tag:github.com,2008:Repository/1353124934/v0.2.0</id>",
    "    <updated>2026-09-10T00:00:00Z</updated>",
    '    <link rel="alternate" type="text/html" href="https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.0"/>',
    "    <title>tmd-cli v0.2.0</title>",
    "    <content type=\"html\">&lt;p&gt;Automated build. See &lt;a href=\"x\"&gt;log&lt;/a&gt; &amp; notes.&lt;/p&gt;</content>",
    "  </entry>",
    "</feed>",
  ].join("\n");

  it("首条 entry → 完整映射(tag 剥 v、notes 解码去标签压空白)", () => {
    expect(parseAtomLatest(atom)).toEqual({
      version: "0.2.0",
      name: "tmd-cli v0.2.0",
      htmlUrl: "https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.0",
      publishedAt: "2026-09-10T00:00:00Z",
      notes: "Automated build. See log & notes.",
    });
  });

  it.each([
    ["空 feed(无 entry)", "<feed></feed>"],
    ["tag 非 semver", '<feed><entry><id>tag:x/nightly</id><link rel="alternate" href="https://x"/></entry></feed>'],
    ["link 缺失", '<feed><entry><id>tag:x/v0.2.0</id></entry></feed>'],
    ["空字符串", ""],
  ])("%s → null", (_label, xml) => {
    expect(parseAtomLatest(xml)).toBeNull();
  });
});

describe("checkLatestRelease", () => {
  it("无 Tauri runtime(浏览器 dev)→ 分级提示,不发请求", async () => {
    vi.stubGlobal("window", {});
    await expect(checkLatestRelease()).resolves.toMatchObject({
      release: null,
      error: expect.stringContaining("浏览器 dev"),
    });
    expect(quotaFetch).not.toHaveBeenCalled();
  });

  it("200 + atom 文本 → release;text 模式与 atom URL 传入 quotaFetch", async () => {
    quotaFetch.mockImplementation(async () => ({
      status: 200,
      body: '<feed><entry><id>tag:github.com,2008:Repository/1/v0.2.0</id><updated>2026-09-10T00:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/chenxiangning/tmd-cli/releases/tag/v0.2.0"/><title>tmd-cli v0.2.0</title></entry></feed>',
    }));
    const result = await checkLatestRelease();
    expect(result.error).toBeNull();
    expect(result.release?.version).toBe("0.2.0");
    expect(quotaFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining("releases.atom"), text: true }),
    );
  });

  it("HTTP 403 → 错误带状态码(限流不再冒充网络不可用)", async () => {
    quotaFetch.mockImplementation(async () => ({ status: 403, body: "rate limited" }));
    const { release, error } = await checkLatestRelease();
    expect(release).toBeNull();
    expect(error).toContain("403");
  });

  it("响应非字符串 / 解析不出 → 格式异常提示", async () => {
    quotaFetch.mockImplementation(async () => ({ status: 200, body: null }));
    const { release, error } = await checkLatestRelease();
    expect(release).toBeNull();
    expect(error).toContain("格式异常");
  });

  it("请求抛错 → 网络失败提示含原因,不抛", async () => {
    quotaFetch.mockImplementation(async () => {
      throw new Error("http send: timeout");
    });
    const { release, error } = await checkLatestRelease();
    expect(release).toBeNull();
    expect(error).toContain("http send: timeout");
  });
});

describe("CHANGELOG_ENTRIES(打包内嵌管线,更新记录弹窗数据面)", () => {
  const entries = CHANGELOG_ENTRIES;

  it("内嵌 CHANGELOG 解析出全部版本小节且顺序为最新在前", () => {
    expect(entries.length).toBeGreaterThanOrEqual(7);
    expect(entries[0]?.version).toBe("0.1.6");
    for (let i = 1; i < entries.length; i++) {
      const prev = extractSemver(entries[i - 1]?.version ?? "");
      const cur = extractSemver(entries[i]?.version ?? "");
      expect(prev).not.toBeNull();
      expect(cur).not.toBeNull();
      expect(isNewerVersion(prev ?? "", cur ?? "")).toBe(true);
    }
  });

  it("每个版本小节都渲染得出内容:至少一个块且块内至少一条", () => {
    for (const entry of entries) {
      expect(entry.blocks.length, `v${entry.version} 无内容块`).toBeGreaterThan(0);
      for (const block of entry.blocks) {
        expect(block.items.length, `v${entry.version} 的「${block.heading}」块为空`).toBeGreaterThan(0);
      }
    }
  });

  it("当前发版版本(0.1.6)在记录中且带日期", () => {
    const head = entries[0];
    expect(head?.version).toBe("0.1.6");
    expect(head?.date).toBe("2026-09-12");
  });
});
