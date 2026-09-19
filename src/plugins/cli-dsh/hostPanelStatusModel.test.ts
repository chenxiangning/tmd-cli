/**
 * DSH 主机面板状态模型契约测试(panelCopy/dotColor/hostFacts)。
 * 覆盖:panelCopy 标题五态判别与优先级(pending > 缺二进制 > 已连接 >
 * 未运行 > 探测中,含缺二进制压过已连接的钉子);说明文案配对
 * (已连接 meta 为 null;缺二进制给安装指引;未运行 meta 带 origin 插值);
 * dotColor 三色映射(connected 压过 down);hostFacts 字段缺失跳过、
 * sessions=0 仍上屏、非数值 sessions 跳过、null 视图空数组。
 */
import { describe, expect, it } from "vitest";
import { dotColor, hostFacts, panelCopy } from "./hostPanelStatusModel";
import { DEFAULT_CONNECTION, type DshConnection } from "./dshConnection";
import type { DshHostView } from "./dshHost";

const CONN: DshConnection = { ...DEFAULT_CONNECTION };
const INSTALL_HINT = "先装本地 dsh。模型和密钥仍然去 DSH Web UI 配。";
const DOWN_HINT = `连不上 ${`http://${CONN.host}:${CONN.port}`}。自动启动只影响下次对话;要现在拉起请点立即启动。`;
const DESCRIBE_HINT = "只信 host.describe,不把端口通当作已就绪。";

describe("panelCopy 标题判别与优先级", () => {
  it("五态各归其位", () => {
    expect(panelCopy(null, true, false, false, CONN).title).toBe("正在探测本地 host");
    expect(panelCopy(null, true, true, false, CONN).title).toBe("主机已连接");
    expect(panelCopy(null, true, false, true, CONN).title).toBe("主机未运行");
    expect(panelCopy(null, false, false, false, CONN).title).toBe("未安装 DSH CLI");
    expect(panelCopy("check", true, false, false, CONN).title).toBe("正在启动…");
    expect(panelCopy("stop", true, true, false, CONN).title).toBe("正在启动…");
  });

  it("缺二进制压过已连接/未运行(未装 CLI 时连接态无从谈起)", () => {
    expect(panelCopy(null, false, true, false, CONN).title).toBe("未安装 DSH CLI");
    expect(panelCopy(null, false, false, true, CONN).title).toBe("未安装 DSH CLI");
  });
});

describe("panelCopy 说明文案配对", () => {
  it("已连接 meta 为 null(无需指引)", () => {
    expect(panelCopy(null, true, true, false, CONN).meta).toBeNull();
  });

  it("缺二进制给安装指引;未运行给带 origin 插值的拉起指引;其余给 describe 说明", () => {
    expect(panelCopy(null, false, false, false, CONN).meta).toBe(INSTALL_HINT);
    expect(panelCopy(null, true, false, true, CONN).meta).toBe(DOWN_HINT);
    expect(panelCopy(null, true, false, false, CONN).meta).toBe(DESCRIBE_HINT);
  });

  it("meta 优先级:已连接 → null,即使缺二进制也不给安装指引", () => {
    expect(panelCopy(null, false, true, false, CONN).meta).toBeNull();
  });
});

describe("dotColor 状态点三色映射", () => {
  it("connected 绿 / down 红 / 其余黄;connected 压过 down", () => {
    expect(dotColor(true, false)).toBe("var(--tmd-ok)");
    expect(dotColor(false, true)).toBe("var(--tmd-err)");
    expect(dotColor(false, false)).toBe("var(--tmd-warn)");
    expect(dotColor(true, true)).toBe("var(--tmd-ok)");
  });
});

describe("hostFacts 已连接事实数组", () => {
  it("齐全视图按 供应商/模型/会话数 出齐", () => {
    const view: DshHostView = { provider: "anthropic", model: "grok-4", sessions: 3 };
    expect(hostFacts(view)).toEqual([
      ["当前供应商", "anthropic"],
      ["当前模型", "grok-4"],
      ["已挂会话", "3"],
    ]);
  });

  it("字段缺失逐项跳过;null 视图为空数组", () => {
    expect(hostFacts({})).toEqual([]);
    expect(hostFacts({ provider: "p" })).toEqual([["当前供应商", "p"]]);
    expect(hostFacts(null)).toEqual([]);
  });

  it("sessions=0 仍上屏(数值 0 是事实);非数值 sessions 跳过", () => {
    expect(hostFacts({ sessions: 0 })).toEqual([["已挂会话", "0"]]);
    expect(hostFacts({ sessions: "3" as unknown as number })).toEqual([]);
  });
});
