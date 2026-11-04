/**
 * RPC 对话框工具条 —— 与 PTY ComposerToolbar 同排布(模型/思考/上下文 +
 * 右侧动作组),从 ssComposer 拆出(300 行铁则)。RPC 态来自 ss 权威态
 * (无 seeded 歧义),模型/思考位纯展示(变更走 header 菜单);右侧 = 展开/
 * 收起(两段高) + 命令抽屉钮(唤起 / 命令目录,RPC 版 ⌘K)。
 */
import { CaretDown, CaretUp, Sidebar } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { SsSessionState } from "./ssSession";

export function SsToolbar({ ss, onExpand, onCollapse, onPalette }: {
  ss: SsSessionState;
  onExpand: () => void;
  onCollapse: () => void;
  onPalette: () => void;
}) {
  const pct = ss.stats?.contextPercent;
  const tok = ss.stats?.totalTokens;
  const iconBtn = "grid h-6 w-6 place-items-center rounded-md transition-colors disabled:opacity-40";
  return (
    <div className="ss-toolbar">
      <span className="ss-toolbar-slot" title={t("模型与思考级")}>
        <span aria-hidden>{t("模型")}</span>
        <span className="ss-toolbar-mono">{ss.model?.id ?? "—"}</span>
      </span>
      <span aria-hidden className="ss-toolbar-sep" />
      <span className="ss-toolbar-slot" title={ss.thinkingLevel ?? t("未识别思考强度")}>
        <span aria-hidden>{t("思考")}</span>
        <span className="ss-toolbar-mono">{ss.thinkingLevel ?? "—"}</span>
      </span>
      {ss.stats ? (
        <>
          <span aria-hidden className="ss-toolbar-sep" />
          <span
            className="ss-toolbar-slot"
            title={t("上下文占用 {p}%,本轮会话累计 {n} tokens", {
              p: pct?.toFixed(1) ?? "—",
              n: tok ?? "—",
            })}
          >
            <span className="ss-toolbar-mono">{pct != null ? `${pct.toFixed(1)}%` : "—"}</span>
          </span>
        </>
      ) : null}
      <span className="flex-1" />
      <button type="button" title={t("展开对话框")} aria-label={t("展开对话框")} onClick={onExpand} className={`${iconBtn} text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}>
        <CaretUp size="0.875rem" />
      </button>
      <button type="button" title={t("收起对话框")} aria-label={t("收起对话框")} onClick={onCollapse} className={`${iconBtn} text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}>
        <CaretDown size="0.875rem" />
      </button>
      <button
        type="button"
        aria-label={t("命令与技能")}
        title={t("命令与技能")}
        data-hint={t("命令与技能")}
        disabled={ss.phase !== "ready"}
        onClick={onPalette}
        className={`${iconBtn} text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}
      >
        <Sidebar size="0.875rem" />
      </button>
    </div>
  );
}
