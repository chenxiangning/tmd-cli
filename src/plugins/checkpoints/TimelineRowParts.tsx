/**
 * TimelineRow 拆件(300 行铁则 + 复杂度摊平):
 * RowRail = 左轨圆点/连接线;AttachmentFiles = 文件附件 chip 横排。
 * 均为 TimelinePanel 行内纯展示件,状态全部由行自身持有。
 */

import { FileText } from "@phosphor-icons/react";

/** 左轨:圆点 + 向下连接线(最旧一条不画)。 */
export function RowRail({ last, live }: { last: boolean; live: boolean }) {
  return (
    <div className="relative w-3 flex-none" aria-hidden>
      {!last && <div className="absolute top-4 -bottom-2 left-[5px] w-px bg-(--tmd-border)" />}
      <span
        className={`absolute top-[7px] left-[2px] h-2 w-2 rounded-full border-2 border-(--tmd-accent) ${
          live ? "bg-(--tmd-accent)" : "bg-(--tmd-bg-base)"
        }`}
      />
    </div>
  );
}

/** 文件附件 chip:目录截断 + 文件名常驻。 */
export function AttachmentFiles({ files }: { files: string[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {files.map((p) => {
        const slash = p.lastIndexOf("/");
        return (
          <span
            key={p}
            title={p}
            className="flex max-w-full items-center gap-1 rounded-(--tmd-radius-sm) border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1.5 py-px text-meta leading-4 text-(--tmd-fg-muted)"
          >
            <FileText size="0.625rem" className="flex-none text-(--tmd-fg-subtle)" aria-hidden />
            <span className="truncate font-mono text-(--tmd-fg-faint)">
              {p.slice(0, slash + 1)}
            </span>
            <span className="flex-none font-mono text-(--tmd-fg)">{p.slice(slash + 1)}</span>
          </span>
        );
      })}
    </div>
  );
}
