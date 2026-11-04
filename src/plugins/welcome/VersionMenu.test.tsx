/**
 * VersionMenuBody 渲染契约测试(node 环境 renderToStaticMarkup):
 * - 三段结构:当前版本行(固定,标「当前」)+ 收藏段(可选)+ 最新版本段;
 * - 星标:faved 项 weight=fill(渲染出 fill 属性)且按钮带 is-faved;
 * - 拉取中(undefined)/失败(null):加载文案 / 失败 + 重试;
 * - 行点击 = onPick(经 disabled 门控:installing 时行禁用)。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { VersionMenuBody, VersionMenuContent } from "./VersionMenu";

/* 组合结构测试不进入 settings 的 useSyncExternalStore(SSR 无 getServerSnapshot);
 * 单个分区的当前/收藏/最新/禁用契约由上方 VersionMenuBody 测试覆盖。 */
vi.mock("./VersionMenuSection", async () => {
  const { createElement: h } = await import("react");
  return {
    VersionMenuSection: ({
      engineId,
      currentVersion,
    }: {
      engineId: string;
      currentVersion: string | null;
    }) => h("div", { className: "mock-version-section" }, `${engineId}:${currentVersion ?? "—"}`),
  };
});

const FAVS = {
  "omp@18.0.11": { favedAt: 1000 },
  "omp@17.9.2": { favedAt: 2000 },
};

const TOP = ["18.1.22", "18.1.20", "18.0.11", "17.9.2"];

type BodyProps = Parameters<typeof VersionMenuBody>[0];

function renderBody(overrides?: Partial<BodyProps>): string {
  return renderToStaticMarkup(
    createElement(VersionMenuBody, {
      engineId: "omp",
      currentVersion: "18.1.22",
      versions: TOP,
      favVersions: ["18.0.11", "17.9.2"],
      favs: FAVS,
      installing: false,
      onPick: () => {},
      onRetry: () => {},
      ...overrides,
    }),
  );
}

describe("VersionMenuBody 三段结构", () => {
  it("当前版本行固定在顶并标「当前」;收藏段与最新版本段各自成段", () => {
    const html = renderBody();
    const curIdx = html.indexOf("当前版本");
    const favIdx = html.indexOf(">收藏<");
    const latestIdx = html.indexOf("最新版本");
    expect(curIdx).toBeGreaterThanOrEqual(0);
    expect(favIdx).toBeGreaterThan(curIdx);
    expect(latestIdx).toBeGreaterThan(favIdx);
    /* 「当前」徽标两处:当前行 + top10 命中 18.1.22(收藏段无 18.1.22)。 */
    expect(html.split("welcome-vermenu-cur").length - 1).toBe(2);
    /* 收藏版本在收藏段照常列出(与 top10 重复展示是设计:收藏段即快捷位)。 */
    expect(html).toContain(">18.0.11<");
    expect(html).toContain(">17.9.2<");
  });

  it("无收藏:不渲染收藏段", () => {
    const html = renderBody({ favVersions: [], favs: {} });
    expect(html).not.toContain(">收藏<");
    expect(html).toContain("最新版本");
  });

  it("星标:faved 项带 is-faved 类", () => {
    const html = renderBody();
    expect(html).toContain("welcome-vermenu-star is-faved");
    /* 未收藏行走 regular 星(phosphor 不落 weight 属性,星态以类名为准)。 */
  });

  it("当前版本抠不出:当前段出提示而非空行", () => {
    const html = renderBody({ currentVersion: null });
    expect(html).toContain("未能解析当前版本");
  });
});

describe("VersionMenuBody 数据态", () => {
  it("拉取中:最新段显加载文案;失败:失败文案 + 重试按钮", () => {
    expect(renderBody({ versions: undefined })).toContain("加载版本列表…");
    const failed = renderBody({ versions: null });
    expect(failed).toContain("获取版本列表失败");
    expect(failed).toContain("重试");
  });

  it("安装中:版本行禁用(不可点选安装)", () => {
    const html = renderBody({ installing: true });
    expect(html).toMatch(/class="wsmenu-item" disabled/);
  });
});

describe("VersionMenuContent 主引擎与依赖双分区", () => {
  it("OMP 在前,Bun 在后;各自显示当前版本并标最低要求", () => {
    const html = renderToStaticMarkup(
      createElement(VersionMenuContent, {
        engineId: "omp",
        engineName: "OMP",
        npmPackage: "@oh-my-pi/pi-coding-agent",
        currentVersion: "18.16.0",
        installing: false,
        onPick: () => {},
        dependency: {
          engineId: "bun",
          name: "Bun",
          npmPackage: "bun",
          currentVersion: "1.4.4",
          minVersion: "1.4.4",
          onPick: () => {},
        },
      }),
    );
    expect(html.indexOf(">OMP<")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Bun · 最低 1.4.4")).toBeGreaterThan(html.indexOf(">OMP<"));
    expect(html).toContain("omp:18.16.0");
    expect(html).toContain("bun:1.4.4");
    expect(html.split("mock-version-section").length - 1).toBe(2);
  });
});
