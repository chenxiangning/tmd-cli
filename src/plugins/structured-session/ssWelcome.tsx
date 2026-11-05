/**
 * SsWelcome —— RPC 会话空态引导(2026-11-06 用户反馈「初始化后大白页不友好」):
 * 会话 ready 且无对话块时渲染,三段信息层级引导开场 ——
 *   引擎问候(图标 + 「与 {engine} 开始对话」)
 *   能力提示(三点小字:渲染过程 / 内联审批 / 流式答复)
 *   开场示例 chips(点击即发送,直接起动第一轮)
 * 样式 ss-welcome*(structured-session.css);点击出口 = ssSession.send(override)。
 */

import { Brain, Chats, CheckCircle, Lightning } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { CliProfile } from "@kernel/cli";

/** 能力提示(键名经 t() 渲染,词典见 locales/en|ja)。 */
const FEATURES: ReadonlyArray<readonly [Icon: typeof Brain, key: string]> = [
  [Brain, "思考与工具过程卡片化、实时可见"],
  [CheckCircle, "审批请求内联确认,不用切窗口"],
  [Lightning, "token 级流式答复"],
];

/** 开场示例( cwd 无关的通用问法;点击即发送)。 */
const EXAMPLES = [
  "介绍一下当前项目的目录结构和核心模块",
  "帮我审查最近的代码变更,找出潜在问题",
  "给这个项目写一份 README 摘要",
];

export function SsWelcome({ profile, onExample }: {
  profile: CliProfile;
  onExample: (text: string) => void;
}) {
  return (
    <div className="ss-welcome">
      <div className="ss-welcome-hero">
        <span className="ss-welcome-icon" aria-hidden>
          {profile.renderIcon?.("1.75rem") ?? <Chats size="1.75rem" />}
        </span>
        <h2 className="ss-welcome-title">{t("与 {engine} 开始对话", { engine: profile.name })}</h2>
        <p className="ss-welcome-sub">{t("带渲染的会话:思考与工具过程实时可见")}</p>
      </div>
      <ul className="ss-welcome-feats">
        {FEATURES.map(([Icon, key]) => (
          <li key={key}>
            <Icon size="0.875rem" weight="bold" aria-hidden />
            {t(key)}
          </li>
        ))}
      </ul>
      <div className="ss-welcome-chips">
        <span className="ss-welcome-chips-label">{t("试试这些开场:")}</span>
        {EXAMPLES.map((e) => (
          <button key={e} type="button" className="ss-welcome-chip" onClick={() => onExample(e)}>
            {t(e)}
          </button>
        ))}
      </div>
    </div>
  );
}
