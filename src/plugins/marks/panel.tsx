/**
 * 全局标记中心 —— 右栏面板:跨文件分组聚合、状态一目了然、定位/重发/删除。
 * 发送不走面板:pending 标记在下一次 composer 发送时经 marksSendTransform 自动
 * 尾部引用块带上(council 裁决的状态机语义),面板只管编排与状态可见。
 */

import { t } from "@kernel/i18n";
import { useWorkspaces } from "@kernel/workspace";
import type { Mark, MarkState } from "./anchor";
import { removeMark, setMarkState, toggleExpanded, updateNote, useMarksState } from "./store";
import { sendMarksToComposer } from "./sendTransform";
import { openAndReveal } from "./terminalLink";

const STATE_COLOR: Record<MarkState, string> = {
  pending: "text-(--tmd-warn)",
  sent: "text-(--tmd-accent)",
  drifted: "text-(--tmd-warn)",
  lost: "text-(--tmd-err)",
};

const STATE_LABEL: Record<MarkState, string> = {
  pending: "待发送",
  sent: "已发送",
  drifted: "漂移已重定位",
  lost: "失联",
};

function relPath(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function MarkCard({
  mark,
  root,
  expanded,
}: {
  mark: Mark;
  root: string;
  expanded: boolean;
}) {
  const range = mark.startLine === mark.endLine ? `L${mark.startLine}` : `L${mark.startLine}-${mark.endLine}`;
  return (
    <div className="rounded-lg border border-(--tmd-border) bg-(--tmd-bg-base) px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <b className={STATE_COLOR[mark.state]}>⚑</b>
        <button
          type="button"
          className="cursor-pointer font-mono text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={() => openAndReveal(mark.path, mark.startLine)}
          title={t("定位到标记")}
        >
          {range}
        </button>
        <span className={`rounded-full px-1.5 ${STATE_COLOR[mark.state]}`}>{STATE_LABEL[mark.state]}</span>
        <button
          type="button"
          className="ml-auto cursor-pointer text-(--tmd-fg-faint) hover:text-(--tmd-err)"
          onClick={() => removeMark(root, mark.id)}
          title={t("删除标记")}
        >
          ×
        </button>
      </div>
      <pre className="mt-1 overflow-hidden rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-1.5 font-mono text-[0.65rem] text-(--tmd-fg-muted)">
        {mark.excerpt}
      </pre>
      {expanded ? (
        <textarea
          rows={2}
          value={mark.note}
          placeholder={t("写标注,下次发送自动带上…")}
          onChange={(event) => updateNote(root, mark.id, event.target.value)}
          className="mt-1 w-full resize-y rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-1.5 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
        />
      ) : mark.note ? (
        <div className="mt-1 truncate text-(--tmd-fg)">{mark.note}</div>
      ) : null}
      <div className="mt-1 flex gap-1.5">
        <button
          type="button"
          className="cursor-pointer rounded-md border border-(--tmd-border) px-1.5 py-px text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          onClick={() => toggleExpanded(mark.id)}
        >
          {expanded ? t("收起") : t("备注")}
        </button>
        {mark.state !== "pending" ? (
          <button
            type="button"
            className="cursor-pointer rounded-md border border-(--tmd-warn) px-1.5 py-px text-(--tmd-warn)"
            onClick={() => setMarkState(root, mark.id, "pending")}
          >
            {t("↩ 重发")}
          </button>
        ) : (
          <button
            type="button"
            className="cursor-pointer rounded-md border border-(--tmd-accent) px-1.5 py-px text-(--tmd-accent)"
            onClick={() => setMarkState(root, mark.id, "sent")}
          >
            {t("✓ 不随下次发送")}
          </button>
        )}
      </div>
    </div>
  );
}

export function MarksPanel() {
  const snap = useMarksState();
  const { list, activeId } = useWorkspaces();
  const root = list.find((ws) => ws.id === activeId)?.root ?? list[0]?.root ?? null;
  const marks = root ? (snap.byCwd[root] ?? []) : [];
  const pendingCount = marks.filter((mark) => mark.state === "pending").length;

  /* 按文件分组(保插入序):全局中心的跨文件聚合面 */
  const groups = new Map<string, Mark[]>();
  for (const mark of marks) {
    const group = groups.get(mark.path) ?? [];
    group.push(mark);
    groups.set(mark.path, group);
  }
  const expanded = new Set(snap.expandedIds);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-muted)">
        <span>
          {t(`${marks.length} 处标记 · ${groups.size} 个文件`)}
        </span>
        {pendingCount > 0 ? (
          <span className="text-(--tmd-warn)">{t(`待发送 ${pendingCount}`)}</span>
        ) : null}
        {pendingCount > 0 && root ? (
          <button
            type="button"
            className="ml-auto cursor-pointer rounded-md border border-(--tmd-accent) px-1.5 py-px text-(--tmd-accent) hover:bg-(--tmd-bg-hover)"
            onClick={() => sendMarksToComposer(root, marks.filter((mark) => mark.state === "pending"))}
          >
            {t(`⚑ 发送全部 (${pendingCount})`)}
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {marks.length === 0 ? (
          <div className="p-4 text-center text-xs text-(--tmd-fg-faint)">
            {t("在文件里选中行,点「⚑ 标记」落锚;标记在此跨文件汇总。")}
          </div>
        ) : null}
        {[...groups.entries()].map(([path, group]) => (
          <div key={path} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1 px-1">
              <button
                type="button"
                className="cursor-pointer truncate text-left text-[0.65rem] text-(--tmd-fg-subtle) hover:text-(--tmd-fg-muted)"
                onClick={() => openAndReveal(path, group[0].startLine)}
                title={t("打开文件")}
              >
                {root ? relPath(path, root) : path}
                <span className="ml-1 text-(--tmd-fg-faint)">{group.length}</span>
              </button>
              {root && group.some((mark) => mark.state === "pending") ? (
                <button
                  type="button"
                  className="ml-auto shrink-0 cursor-pointer rounded-md border border-(--tmd-border) px-1 py-px text-[0.65rem] text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
                  onClick={() =>
                    sendMarksToComposer(root, group.filter((mark) => mark.state === "pending"))
                  }
                >
                  {t("发送本文件")}
                </button>
              ) : null}
            </div>
            {group.map((mark) => (
              <MarkCard key={mark.id} mark={mark} root={root ?? ""} expanded={expanded.has(mark.id)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
