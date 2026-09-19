/**
 * Composer 芯片条 —— marks 贡献给 composer.attachments 挂点的组件。
 *
 * staged(已入对话)标记渲染为芯片:文件名 + 行号区间 + 状态色,点击定位,
 * ✕ 退回 pending(不随消息注入)。发送后 transform 翻 sent,芯片自动消失。
 */

import { t } from "@kernel/i18n";
import { baseName } from "@kernel/pathUtils";
import { useWorkspaces } from "@kernel/workspace";
import { setMarkState, useMarksState } from "./store";
import { openAndReveal } from "./terminalLink";

export function MarksComposerChips() {
  const workspaces = useWorkspaces();
  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? workspaces.list[0]?.root;
  const snap = useMarksState();
  if (!root) return null;
  const staged = (snap.byCwd[root] ?? []).filter((mark) => mark.state === "staged");
  if (staged.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-(--tmd-border) px-2.5 py-1.5">
      <span className="text-[0.65rem] text-(--tmd-fg-faint)">{t("标记引用")}</span>
      {staged.map((mark) => (
        <div
          key={mark.id}
          className="inline-flex items-center gap-1 rounded-full border border-(--tmd-warn) py-px pl-1.5 pr-1 text-[0.65rem] text-(--tmd-fg)"
          title={mark.note ? `${mark.path}:${mark.startLine}-${mark.endLine} · ${mark.note}` : `${mark.path}:${mark.startLine}-${mark.endLine}`}
        >
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1"
            onClick={() => openAndReveal(mark.path, mark.startLine)}
          >
            <span className="text-(--tmd-warn)">⚑</span>
            {baseName(mark.path)}:L{mark.startLine}
            {mark.endLine !== mark.startLine ? `-${mark.endLine}` : ""}
            {mark.note ? <span className="max-w-28 truncate text-(--tmd-fg-muted)">{mark.note}</span> : null}
          </button>
          <button
            type="button"
            aria-label={t("撤回引用(回到待发送)")}
            className="cursor-pointer text-(--tmd-fg-subtle) hover:text-(--tmd-fg)"
            onClick={() => setMarkState(root, mark.id, "pending")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
