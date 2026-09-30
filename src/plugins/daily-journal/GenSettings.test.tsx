/**
 * 生成设置弹层渲染契约(react-dom/server 静态渲染,模式同 kernel/iconSet.test.tsx):
 * - 引擎行按钮命中品牌 glyph(cli-shared/engineGlyphs 单一来源),qoder-cn 复用
 *   qoder 字形(前缀映射),未知引擎回落纯文字;
 * - 增量策略三档逐项说明随选中项切换,文案与 journalSchedule 实际消费语义一致
 *   (auto 会话收尾自动并入 / manual 仅手动触发 / timer 次日定时归纳)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.mock("@kernel/DialogShell", () => ({
  DialogShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: () => [
      { id: "omp", listSessions: async () => [] },
      { id: "pi", listSessions: async () => [] },
      { id: "qoder-cn", listSessions: async () => [] },
      { id: "mystery", listSessions: async () => [] },
    ],
  },
}));
vi.mock("./journalStore", () => ({
  useJournalState: () => ({ config: { ...CONFIG.config } }),
  updateConfig: vi.fn(),
}));
vi.mock("./holidays", () => ({ ensureHolidays: vi.fn() }));
vi.mock("@plugins/memory-coordinator/modelCatalog", () => ({ listModels: vi.fn(async () => []) }));

const CONFIG = vi.hoisted(() => ({
  config: {
    timerOn: true,
    timerTime: "08:00",
    incPolicy: "auto" as "auto" | "manual" | "timer",
    engine: "omp",
    model: "",
    holidaysOn: true,
  },
}));

import { GenSettings } from "./GenSettings";

function render(): string {
  return renderToStaticMarkup(createElement(GenSettings, { onClose: () => undefined }));
}

describe("GenSettings 引擎行品牌 glyph", () => {
  it("已知引擎按钮渲染品牌 svg,qoder-cn 复用 qoder 字形", () => {
    const html = render();
    const btnContent = (label: string) =>
      [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
        .map((m) => m[1])
        .find((c) => c.endsWith(label));
    /* 品牌引擎按钮内嵌品牌 svg(含 qoder-cn 前缀复用);未知引擎纯文字。 */
    expect(btnContent("omp")).toMatch(/<svg/);
    expect(btnContent("qoder-cn")).toMatch(/<svg/);
    expect(btnContent("mystery")).not.toMatch(/<svg/);
  });
});

describe("GenSettings 增量策略逐项说明", () => {
  it("auto:说明会话收尾自动并入", () => {
    CONFIG.config.incPolicy = "auto";
    expect(render()).toContain("会话收尾约 45 秒后自动整理当日");
  });
  it("manual:说明仅主动发起才更新,并点到增量并入入口", () => {
    CONFIG.config.incPolicy = "manual";
    const html = render();
    expect(html).toContain("只在主动发起时更新");
    expect(html).toContain("增量并入");
    expect(html).not.toContain("自动整理当日");
  });
  it("timer:说明次日定时归纳", () => {
    CONFIG.config.incPolicy = "timer";
    const html = render();
    expect(html).toContain("留到次日定时任务一次归纳成文");
    expect(html).toContain("随时可手动点生成");
  });
});
