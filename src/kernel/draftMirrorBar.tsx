/**
 * 草稿恢复条 —— 三 kind(files / journal 便签 / ssh-file)共用的镜像恢复黄条
 * (0.4.0 项 12)。崩溃/强退后重开,编辑器顶部提示「上次未保存草稿」:
 * 恢复 = 回填编辑器并置脏;丢弃 = 清镜像。纯展示组件,镜像读写与恢复语义
 * 由各消费方接线(kernel/draftMirror)。
 */
import { t } from "@kernel/i18n";
import type { DraftMirrorEntry } from "./draftMirror";

/** 相对时间:分钟粒度足够(草稿是「数分钟前」的意图,不是秒级事件)。 */
function agoText(savedAt: number): string {
  const min = Math.max(1, Math.round((Date.now() - savedAt) / 60000));
  if (min < 60) return t("{n} 分钟前", { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("{n} 小时前", { n: hours });
  return t("{n} 天前", { n: Math.floor(hours / 24) });
}

export function DraftMirrorBar({
  mirror,
  onRestore,
  onDiscard,
}: {
  /** null = 无可恢复草稿,组件不渲染(消费方可无条件挂载)。 */
  mirror: DraftMirrorEntry | null;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (!mirror) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-(--tmd-warn)/40 bg-(--tmd-warn)/10 px-3 py-1.5 text-xs text-(--tmd-warn)">
      <span>{t("检测到上次未保存草稿({time})", { time: agoText(mirror.savedAt) })}</span>
      {mirror.truncated ? (
        <span className="text-(--tmd-fg-faint)">{t("草稿超过 256KB,恢复仅保留前缀")}</span>
      ) : null}
      <span className="ml-auto flex gap-1.5">
        <button
          type="button"
          className="rounded border border-(--tmd-border) px-2 py-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          onClick={onRestore}
        >
          {t("恢复")}
        </button>
        <button
          type="button"
          className="rounded border border-(--tmd-border) px-2 py-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          onClick={onDiscard}
        >
          {t("丢弃")}
        </button>
      </span>
    </div>
  );
}
