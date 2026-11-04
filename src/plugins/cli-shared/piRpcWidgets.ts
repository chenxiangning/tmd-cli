/**
 * RPC 部件帧纯函数 —— 自 piRpcReducer 拆出(300 行铁则)。非 confirm 部件
 * 自动取消判定与 chrome/interactive 分档:extension_ui_request 且 method 非
 * confirm(select/input/editor 等真交互部件)时,RPC 模式无人可答,按协议回
 * cancelled 并产转录 notice 文案 —— 不再无声替答;confirm 走审批回路不在此列;
 * chrome 装饰类(widgetTier 判 chrome:setStatus/notify/setWidget)在 piRpc
 * 层静默应答后丢弃,不经此函数;缺 id 的畸形帧不产(无处应答也无从示警;
 * 调用侧已将数值 id 归一为字符串,见 piRpc.normWidgetFrameId)。
 */
import { t } from "@kernel/i18n";

/** 时分秒(词典无关的 locale 中立形态;notice 时刻用)。 */
export function clockOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function widgetCancelledNotice(
  rec: Record<string, unknown>,
  now: Date = new Date(),
): { frameId: string; kind: string; text: string } | null {
  if (rec.type !== "extension_ui_request") return null;
  const kind = rec.method;
  if (typeof kind !== "string" || !kind || kind === "confirm") return null;
  const frameId = rec.id;
  if (typeof frameId !== "string" || !frameId) return null;
  return {
    frameId,
    kind,
    text: `${t("CLI 发起 {kind} 交互,已按协议自动取消", { kind })}(${clockOf(now)})`,
  };
}

/** TUI 装饰类部件(omp 18.x 启动/轮次帧实证:setStatus 状态行、notify 通知、
 * setWidget 小部件注册):RPC 模式下永远无意义,协议层静默应答 cancelled 后
 * 直接丢弃(2026-11-05 减法收口,取代 2026-10-02 的聚合 ×N 行方案——实测单轮
 * ×50+ 仍占转录版面);select/input/editor 等真交互与未知 kind 一律
 * interactive 逐条可见——宁可多显示不可静默。 */
const CHROME_WIDGET_KINDS: Record<string, true> = { setStatus: true, notify: true, setWidget: true };

/** 部件分档(纯函数,单测钉死):chrome = TUI 装饰,interactive = 其余一切。 */
export function widgetTier(kind: string): "chrome" | "interactive" {
  return CHROME_WIDGET_KINDS[kind] ? "chrome" : "interactive";
}
