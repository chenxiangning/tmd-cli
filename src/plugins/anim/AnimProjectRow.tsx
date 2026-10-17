/**
 * anim · 项目列表单行(卡片式):文件图标 + 项目名/文件名两行主列 +
 * 「打开」(tmd-anim 应用)与「AI 会话」动作。文件名本身可点 ——
 * 走内核文件深链契约 openFileInTab(files/search/marks/git 同款),
 * 在应用内编辑器 tab 打开 JSON,不外抛系统默认应用。
 */
import { FileCode, Warning } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { openFileInTab } from "@kernel/fileTabs";

/** 行内动作钮统一形(主列右侧,悬停染 accent)。 */
const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50";

export function AnimProjectRow({
  path,
  file,
  name,
  scenes,
  starting,
  /** false(非 macOS)= 不渲染「打开」钮(open -a 仅 mac 语义,不留死 affordance)。 */
  canOpen,
  onOpen,
  onAi,
}: {
  path: string;
  file: string;
  /** 解析出的项目名;null = 无效项目(警示态)。 */
  name: string | null;
  /** 解析出的场景数;null = 无效项目(不显示)。 */
  scenes: number | null;
  starting: boolean;
  canOpen: boolean;
  onOpen: () => void;
  onAi: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle)/40 px-3 py-2 transition-colors hover:border-(--tmd-accent)/40 hover:bg-(--tmd-bg-subtle)">
      {name === null ? (
        <Warning size="1rem" className="flex-none text-(--tmd-warn)" />
      ) : (
        <FileCode size="1rem" className="flex-none text-(--tmd-fg-muted)" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm text-(--tmd-fg)">
            {name ?? <span className="text-(--tmd-warn)">{t("无效项目")}</span>}
          </span>
          {scenes !== null && (
            <span className="flex-none rounded-full border border-(--tmd-border) px-1.5 text-meta text-(--tmd-fg-muted)">
              {t("{n} 幕", { n: scenes })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => openFileInTab(path)}
          title={t("在编辑器中打开")}
          className="block max-w-full truncate text-left font-mono text-[0.6875rem] text-(--tmd-fg-muted) hover:text-(--tmd-accent)"
        >
          {file}
        </button>
      </div>
      {canOpen && (
        <button type="button" onClick={onOpen} className={ACTION_CLS}>
          {t("打开")}
        </button>
      )}
      <button type="button" disabled={starting} onClick={onAi} className={ACTION_CLS}>
        {t("AI 会话")}
      </button>
    </li>
  );
}
