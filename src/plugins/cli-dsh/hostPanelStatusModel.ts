/**
 * DshHostPanel 状态行的文案与纯函数 —— 自 hostPanelStatus.tsx 拆出
 * (only-export-components):组件(HostFactsRow/HostActions)留在原 tsx,
 * 本文件只留标题/说明文案、状态点色与已连接事实数组。
 */

import { t } from "@kernel/i18n";
import type { DshHostView } from "./dshHost";
import { isLocalHost, isWildcardBindHost, originOf, type DshConnection } from "./dshConnection";

/** 面板文案常量(纯文案,集中在模型文件里,渲染件与容器共用)。 */
export const DOWN_ERROR = "连不上本地 host。确认 dsh web 已启动,或点立即启动。";
export const REMOTE_STOP_ERROR = "只能停掉本机 DSH host。远程地址不会被关闭。";
export const UNAUTHORIZED_ERROR = "host 在运行但拒绝本端凭据(疑似外部拉起)。点立即启动换代重启。";
export const FORBIDDEN_ERROR = "host 拒绝了本端来源(Host/Origin 栅栏):非回环地址需在 DSH 侧配 trustedHosts。";
export const WILDCARD_ERROR = "0.0.0.0/:: 不能作为 DSH 监听地址(DSH 启动期直接拒绝)。请填 127.0.0.1 再用 --trusted-host 暴露。";
export const REMOTE_DOWN_ERROR = "远程 origin 连不上。tmd-cli 只代管本机 host,远程请先在那边起 dsh web。";

/** 探针失败原因 → 面板文案(通配地址 > 无凭据 > 栅栏拒绝);成功 = null。 */
export function probeErrorCopy(
  probe: { unauthorized: boolean; forbidden: boolean },
  host: string,
): string | null {
  if (isWildcardBindHost(host)) return t(WILDCARD_ERROR);
  if (probe.unauthorized) return t(UNAUTHORIZED_ERROR);
  if (probe.forbidden) return t(FORBIDDEN_ERROR);
  return null;
}

/** 启动失败文案:通配 ≥ 远程 > 通用。 */
export function startErrorCopy(host: string): string {
  if (isWildcardBindHost(host)) return t(WILDCARD_ERROR);
  return t(isLocalHost(host) ? DOWN_ERROR : REMOTE_DOWN_ERROR);
}

/** 状态行标题/说明文案(不捕获响应值的纯函数):pending → 缺二进制 → 连接态。 */
export function panelCopy(
  pending: "start" | "stop" | "check" | null,
  binFound: boolean,
  connected: boolean,
  down: boolean,
  conn: DshConnection,
): { title: string; meta: string | null } {
  /* connected 优先于 binFound:host 连着却报「未安装」会让用户去改一个没坏的东西,
     且旧实现把「重新检测」按钮一起藏掉。pending 也按真实动作分文案。 */
  const title =
    pending === "start"
      ? t("正在启动…")
      : pending === "stop"
        ? t("正在停止…")
        : pending === "check"
          ? t("正在检测…")
          : connected
            ? t("主机已连接")
            : !binFound
              ? t("未安装 DSH CLI")
              : down
                ? t("主机未运行")
                : t("正在探测本地 host");
  const meta = connected
    ? null
    : !binFound
      ? t("先装本地 dsh。模型和密钥仍然去 DSH Web UI 配。")
      : down
        ? t("连不上 {origin}。自动启动只影响下次对话;要现在拉起请点立即启动。", { origin: originOf(conn) })
        : t("只信 settings/describe 探针,不把端口通当作已就绪。");
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
