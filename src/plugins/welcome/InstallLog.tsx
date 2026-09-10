/**
 * 安装日志区 —— indeterminate 进度条 + 流式日志尾部 + 收尾横幅。
 * 主引擎与前置依赖引导区共用(自 EngineCard.tsx 按「纯结构拆分、行为不变」拆出)。
 */

import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";
import type { InstallState } from "./EngineCard";

export function InstallLog({
  install,
  label,
}: {
  install: InstallState;
  /** 收尾横幅/aria 语境用名词短语:主引擎 "安装",依赖 "Bun 安装"。 */
  label: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  /* 日志追加时滚到底(用户上翻时不打断:仅当已贴底才跟滚)。 */
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (pinned) el.scrollTop = el.scrollHeight;
  }, [install.lines]);

  return (
    <div className="welcome-install">
      {install.running && (
        <div className="welcome-progress" aria-label={label}>
          <div className="welcome-progress-bar" />
        </div>
      )}
      <div className="welcome-install-log" ref={logRef}>
        {install.lines.map((line, i) => (
          <div key={`${i}:${line}`} className="welcome-install-line">
            {line}
          </div>
        ))}
      </div>
      {install.ok === true && (
        <div className="welcome-install-done is-ok">{t("{label}完成", { label })}</div>
      )}
      {install.ok === false && (
        <div className="welcome-install-done is-fail">
          {t("{label}失败,日志见上方", { label })}
        </div>
      )}
    </div>
  );
}
