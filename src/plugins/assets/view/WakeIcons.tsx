/**
 * 唤醒图标 —— composer.inputRail 挂载点贡献:右缘竖向双图标,
 * 点击经 composerWakeRef(kernel ref 桥)让对应触发源弹出候选,
 * 与手敲 !! / ## 同一管线;未选中关闭时 composer 自动回收注入的触发符。
 */

import { Quotes, Robot } from "@phosphor-icons/react";
import { composerWakeRef } from "@kernel/composerExt";
import { t } from "@kernel/i18n";

export function WakeIcons() {
  return (
    <>
      <button
        type="button"
        className="assets-wake-btn"
        title={t("智能体(##)")}
        aria-label={t("智能体(##)")}
        onClick={() => composerWakeRef.current?.("##")}
      >
        <Robot size="0.875rem" />
      </button>
      <button
        type="button"
        className="assets-wake-btn"
        title={t("提示词(!!)")}
        aria-label={t("提示词(!!)")}
        onClick={() => composerWakeRef.current?.("!!")}
      >
        <Quotes size="0.875rem" />
      </button>
    </>
  );
}
