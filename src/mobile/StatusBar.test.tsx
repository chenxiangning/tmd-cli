/**
 * 会话状态条 ask 等待闸契约(react-dom/server 静态渲染,模式同 SpawnSheet.test):
 * - askWait=true:模型 chip disabled(写入会被 CLI 当作答案文本提交,与桌面
 *   模型位/思考位/⌘K 抽屉同律,2026-10-24 评审 P3 收编),title 提示作答路径;
 * - askWait 缺省:模型 chip 可点(无 disabled 属性),原行为不变;
 * - 思考/额度 chip 不受闸影响(纯展示/只读远端)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.mock("./engines", () => ({
 engineOf: () => ({ name: "omp" }),
 engineWire: (_p: string, cmd: string) => cmd,
}));
vi.mock("./remote", () => ({ writeSession: vi.fn(async () => true) }));
vi.mock("./statusProbe", () => ({
 hasMobileQuotaFetcher: () => false,
 readMobileSessionStatus: vi.fn(async () => ({ model: "glm-4.6" })),
 fetchMobileQuota: vi.fn(),
 formatQuotaLine: () => "",
}));

import { StatusBar } from "./StatusBar";

function markup(askWait?: boolean): string {
 return renderToStaticMarkup(
  createElement(StatusBar, {
   sessionId: "s1",
   profileId: "omp",
   cwd: "/w",
   ...(askWait === undefined ? {} : { askWait }),
  }),
 );
}

describe("StatusBar ask 等待闸", () => {
 it("askWait=true:模型 chip disabled 且 title 指引作答路径", () => {
  const html = markup(true);
  expect(html).toContain("disabled");
  expect(html).toContain("等待确认中,先在面板作答");
 });

 it("askWait 缺省:模型 chip 可点,无禁用态", () => {
  expect(markup().includes("disabled")).toBe(false);
 });
});
