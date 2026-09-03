import { host, useHost } from "@kernel/host";
import { collapseComposerStage, expandComposerStage, useComposerStage } from "@kernel/composerStage";
import { ChevronDown, ChevronUp, PanelRight } from "lucide-react";
import { QuotaChip } from "./QuotaChip";
import { toggleDrawer, useDrawerOpen } from "../state/drawerOpen";

export function ComposerToolbar() {
  useHost();
  const sessionId = host.getActiveSessionId();
  const status = sessionId ? host.getSessionStatus(sessionId) : undefined;
  const statusSource = sessionId ? host.getSessionStatusSource(sessionId) : undefined;
  /* seeded = 尚未读到会话实况,展示的是 CLI 默认配置种子(可能与会话实际生效值不符) */
  const seeded = statusSource === "seeded";
  const drawerOpen = useDrawerOpen();
  const stage = useComposerStage();
  const noSession = !sessionId;

  const iconBtn =
    "grid h-6 w-6 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-(--tmd-border) px-2 text-[11px] leading-none text-(--tmd-fg-muted) select-none">
      <span
        className="flex items-center gap-1"
        title={status?.model ?? "未识别模型"}
      >
        <span aria-hidden>模型</span>
        <span className="font-mono text-(--tmd-fg)">{status?.model ?? "—"}</span>
        {seeded && status?.model ? (
          <span
            aria-label="默认模型(尚未读到会话实况)"
            title="来自 CLI 默认配置,尚未读到会话实况"
            className="rounded-sm bg-(--tmd-bg-hover) px-1 text-[10px] text-(--tmd-fg-muted)"
          >
            默认
          </span>
        ) : null}
      </span>
      <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
      <span className="flex items-center gap-1" title={status?.thinkingLevel ?? "未识别思考强度"}>
        <span aria-hidden>思考</span>
        <span className="font-mono text-(--tmd-fg)">{status?.thinkingLevel ?? "—"}</span>
      </span>
      {sessionId ? (
        <>
          <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
          <QuotaChip />
        </>
      ) : null}
      {/* 四段式对话框高度:↑ 逐级展开 / ↓ 逐级收起(collapsed → compact → normal → expanded),AppShell resize composer Panel */}
      <button
        type="button"
        title="展开对话框"
        aria-label="展开对话框"
        disabled={noSession || stage === "expanded"}
        onClick={expandComposerStage}
        className={`${iconBtn} ml-auto text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}
      >
        <ChevronUp size={15} />
      </button>
      <button
        type="button"
        title="收起对话框"
        aria-label="收起对话框"
        disabled={noSession || stage === "collapsed"}
        onClick={collapseComposerStage}
        className={`${iconBtn} text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}
      >
        <ChevronDown size={15} />
      </button>
      {/* 命令抽屉直达开关(closed ↔ open);原「只读」占位(openspec/changes/composer-command-drawer) */}
      <button
        type="button"
        aria-expanded={drawerOpen}
        aria-controls="command-drawer"
        title="命令与技能(⌘K)"
        disabled={noSession}
        onClick={(e) => { e.stopPropagation(); toggleDrawer(); }}
        className={`${iconBtn} ${
          drawerOpen
            ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
            : "text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        }`}
      >
        <PanelRight size={15} />
      </button>
    </div>
  );
}
