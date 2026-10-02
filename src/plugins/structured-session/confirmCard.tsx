/**
 * 审批卡(extension_ui confirm 回路)—— 从 sessionTab 拆出守 300 行铁则。
 * 无障碍与键盘回路:内联非模态卡用 role=group + aria-live=assertive 承担
 * 「出卡即播报」(不冒充 dialog 模态语义);打开即聚焦「拒绝」,Enter 随焦点钮
 * 默认激活(聚焦拒绝即拒绝,误击不放行;Tab 到批准钮再 Enter 才批准),
 * Esc=拒绝,入场动效。
 * 危险分级是插件侧启发式(dangerConfirm.ts;内核零涉及:PiRpcConfirm 只有
 * title/message 两个可读字段,协议不携带操作类型)。
 * react-doctor「prefer-html-dialog」豁免:原生 <dialog> 的模态语义反而不实。
 */
import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";
import type { PiRpcConfirm } from "../cli-shared/piRpc";
import { isDangerConfirm } from "./dangerConfirm";

export function ConfirmCard(props: {
  confirm: PiRpcConfirm;
  onAnswer: (ok: boolean) => void;
}) {
  const { confirm, onAnswer } = props;
  const denyRef = useRef<HTMLButtonElement | null>(null);
  /* 打开即聚焦拒绝(安全默认);ref 方式避免 autoFocus 在 StrictMode 双挂载
   * 期的抢焦竞争。 */
  useEffect(() => {
    denyRef.current?.focus();
  }, []);
  const danger = isDangerConfirm(confirm.title, confirm.message);
  return (
    <div
      className={"ss-confirm" + (danger ? " is-danger" : "")}
      /* 非模态内联卡:group + aria-live=assertive 承担「出卡即播报」,不冒充
       * 对话框语义(原生 dialog 的模态焦点圈与真实交互不符) */
      role="group"
      aria-live="assertive"
      aria-label={confirm.title || t("等待确认")}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          onAnswer(false);
        }
        /* Enter 不拦截:按钮默认激活按焦点走(焦点在拒绝即拒绝),安全默认成立 */
      }}
    >
      <div className="ss-confirm-title">{confirm.title || t("等待确认")}</div>
      <div className="ss-confirm-message">{confirm.message}</div>
      <div className="ss-confirm-actions">
        <button ref={denyRef} type="button" className="ss-confirm-deny" onClick={() => onAnswer(false)}>
          {t("拒绝")}
        </button>
        <button
          type="button"
          className={"ss-confirm-approve" + (danger ? " is-danger" : "")}
          onClick={() => onAnswer(true)}
        >
          {t("批准")}
        </button>
      </div>
    </div>
  );
}
