/**
 * DshHostPanel 状态行的文案与纯函数 —— 自 hostPanelStatus.tsx 拆出
 * (only-export-components):组件(HostFactsRow/HostActions)留在原 tsx,
 * 本文件只留标题/说明文案、状态点色与已连接事实数组。
 */

import { t } from "@kernel/i18n";
import type { DshHostView } from "./dshHost";
import { originOf, type DshConnection } from "./dshConnection";

/** 状态行标题/说明文案(不捕获响应值的纯函数):pending → 缺二进制 → 连接态。 */
export function panelCopy(
  pending: "start" | "stop" | "check" | null,
  binFound: boolean,
  connected: boolean,
  down: boolean,
  conn: DshConnection,
): { title: string; meta: string | null } {
  const title = pending
    ? t("正在启动…")
    : !binFound
      ? t("未安装 DSH CLI")
      : connected
        ? t("主机已连接")
        : down
          ? t("主机未运行")
          : t("正在探测本地 host");
  const meta = connected
    ? null
    : !binFound
      ? t("先装本地 dsh。模型和密钥仍然去 DSH Web UI 配。")
      : down
        ? t("连不上 {origin}。自动启动只影响下次对话;要现在拉起请点立即启动。", { origin: originOf(conn) })
        : t("只信 host.describe,不把端口通当作已就绪。");
  return { title, meta };
}

/** 状态点颜色:connected 绿 / down 红 / 其余黄。 */
export function dotColor(connected: boolean, down: boolean): string {
  return connected ? "var(--tmd-ok)" : down ? "var(--tmd-err)" : "var(--tmd-warn)";
}

/** 已连接态事实数组(供应商/模型/会话数),字段缺失跳过。 */
export function hostFacts(view: DshHostView | null): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (view?.provider) facts.push([t("当前供应商"), view.provider]);
  if (view?.model) facts.push([t("当前模型"), view.model]);
  if (typeof view?.sessions === "number") facts.push([t("已挂会话"), String(view.sessions)]);
  return facts;
}
