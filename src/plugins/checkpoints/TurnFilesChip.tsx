/**
 * 「本轮 N 文件」chip —— 时间线消息行挂接审批线批次(候选8 正向闭环)。
 * 匹配到的消息才渲染(turnMatch);点击行下内联展开该轮 turn_files 变更集
 * (A/M/D 药丸,配色与审批线文件行同源 fileChipCls);git 归因带「推断」
 * 标注,可信度语义与批头徽标同文案(kernel misc 既有键,不冒充 events 精度)。
 */
import { t } from "@kernel/i18n";
import type { CkptBatch, CkptBatchFile } from "@kernel/ipc";
import { fileChipCls } from "./fileChipCls";

/** 归因悬浮说明:与批头状态徽标同文案(kernel misc 既有键)。 */
function attributionTitle(b: CkptBatch): string {
  return b.attribution === "events"
    ? t("归因:AI 写入事件流(账本只记 CLI 声称写过的文件)")
    : t("归因:窗口内 git 变更推断(该 CLI 未声明写入事件检测,可能有误差)");
}

/** 轮次变更集:文件路径药丸(目录截断 + 文件名常驻,同时间线附件 chip 形制)。 */
export function TurnFileList({ files }: { files: readonly CkptBatchFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {files.map((f) => {
        const slash = f.path.lastIndexOf("/");
        return (
          <span
            key={f.path}
            title={f.path}
            className="flex max-w-full items-center gap-1 rounded-(--tmd-radius-sm) border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1.5 py-px text-meta leading-4 text-(--tmd-fg-muted)"
          >
            <span className={`flex-none rounded px-1 font-bold ${fileChipCls(f.status)}`}>
              {f.status}
            </span>
            <span className="truncate font-mono text-(--tmd-fg-faint)">
              {f.path.slice(0, slash + 1)}
            </span>
            <span className="flex-none font-mono text-(--tmd-fg)">{f.path.slice(slash + 1)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** chip + 展开态由行持有(展开区渲染在行主体末尾,不入 meta 行)。 */
export function TurnFilesChip({
  batch,
  open,
  onToggle,
}: {
  batch: CkptBatch;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={attributionTitle(batch)}
      className={`flex-none rounded border px-1 text-meta leading-4 transition-colors ${
        open
          ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-accent)"
          : "border-(--tmd-border) bg-(--tmd-bg-input) text-(--tmd-fg-muted) hover:text-(--tmd-accent)"
      }`}
    >
      {t("本轮 {n} 文件", { n: batch.files.length })}
      {batch.attribution === "git" && (
        <span className="ml-1 rounded border border-dashed border-(--tmd-border-strong) px-0.5 text-2xs text-(--tmd-fg-faint)">
          {t("推断")}
        </span>
      )}
    </button>
  );
}
