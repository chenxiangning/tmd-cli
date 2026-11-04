/**
 * 左下唤醒轨 + 发送 —— 从 ssComposer 拆出(300 行铁则)。与 PTY composer
 * 同几何(composer-anchors.css 的 .composer-input-rail / .composer-rail-btn);
 * 贡献 Mount 不带入,那些是 PTY 会话专属且经全局单例桥,会和 PTY composer
 * 抢注册。引擎声明了哪个触发符就亮哪个(图标即能力探针,隐藏优于置灰)。
 */
import { At, PaperPlaneRight, Quotes, Robot, Sparkle } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function SsWakeRail({ triggerSpecs, wakeTrigger, canSend, onSend }: {
  triggerSpecs: readonly { char: string }[];
  wakeTrigger: (char: string) => void;
  canSend: boolean;
  onSend: () => void;
}) {
  const wake = (char: string) => triggerSpecs.some((s) => s.char === char);
  return (
    <div className="composer-input-rail">
      {/* 智能体/提示词唤醒(PTY assets WakeIcons 同款能力;走本面触发器管线,
         不经 composerWakeRef 单例桥——RPC tab 保活挂载,单例会被 PTY 抢) */}
      {wake("##") ? (
        <button type="button" className="composer-rail-btn" title={t("智能体(##)")} aria-label={t("智能体(##)")} onClick={() => wakeTrigger("##")}>
          <Robot size="0.875rem" />
        </button>
      ) : null}
      {wake("!!") ? (
        <button type="button" className="composer-rail-btn" title={t("提示词(!!)")} aria-label={t("提示词(!!)")} onClick={() => wakeTrigger("!!")}>
          <Quotes size="0.875rem" />
        </button>
      ) : null}
      {wake("@") ? (
        <button type="button" className="composer-rail-btn" title={t("@ 引用文件")} aria-label={t("@ 引用文件")} onClick={() => wakeTrigger("@")}>
          <At size="0.875rem" />
        </button>
      ) : null}
      {wake("$") ? (
        <button type="button" className="composer-rail-btn" title={t("$ 调用技能")} aria-label={t("$ 调用技能")} onClick={() => wakeTrigger("$")}>
          <Sparkle size="0.875rem" />
        </button>
      ) : null}
      <button
        type="button"
        className="composer-rail-btn ss-composer-send"
        title={t("发送")}
        aria-label={t("发送")}
        disabled={!canSend}
        onClick={onSend}
      >
        <PaperPlaneRight size="0.875rem" />
      </button>
    </div>
  );
}
