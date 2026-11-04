/**
 * 欢迎页 CLI 学堂入口 —— 只经命令注册表调用 academy.open。
 * 命令缺失(academy 禁用)或 when 不满足(无课程)时不渲染,欢迎页零死入口。
 */
import { ArrowRight, Student } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useCommands } from "@kernel/shortcuts";

export function WelcomeAcademyAction() {
  const cmd = useCommands().find((c) => c.id === "academy.open");
  if (!cmd || cmd.when?.() === false) return null;
  return (
    <button
      type="button"
      className="welcome-academy"
      onClick={() => cmd.run()}
      aria-label={t("CLI 学堂")}
    >
      <Student size="1rem" className="welcome-academy-icon" aria-hidden />
      <span className="welcome-academy-text">
        <b>{t("CLI 学堂")}</b>
        <small>{t("命令指南与入门课程")}</small>
      </span>
      <ArrowRight size="0.875rem" className="welcome-academy-arrow" aria-hidden />
    </button>
  );
}
