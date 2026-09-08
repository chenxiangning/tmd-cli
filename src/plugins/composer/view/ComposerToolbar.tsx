import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { collapseComposerStage, expandComposerStage, useComposerStage } from "@kernel/composerStage";
import { CaretDown, CaretUp, Sidebar } from "@phosphor-icons/react";
import { QuotaChip } from "./QuotaChip";
import { toggleDrawer, useDrawerOpen } from "../state/drawerOpen";
import { useActiveProfile } from "../state/useActiveProfile";
import { prepareSendPayload } from "../serialize/serialize";

export function ComposerToolbar() {
  useHost();
  const sessionId = host.getActiveSessionId();
  const status = sessionId ? host.getSessionStatus(sessionId) : undefined;
  const statusSource = sessionId ? host.getSessionStatusSource(sessionId) : undefined;
  const seeded = statusSource === "seeded";
  /* seeded = 尚未读到会话实况,展示的是 CLI 默认配置种子(可能与会话实际生效值不符) */
  const noSession = !sessionId;
  const profile = useActiveProfile();
  /* omp 随时可发 /model(其 TUI 支持流中弹出模型选择);其余 CLI 对话进行中
   * 不可发(会串进输出流),等轮次结算(呼吸灯蓝态结束)才生效。 */
  const turnActive = sessionId ? host.isTurnActive(sessionId) : false;
  const modelClickable = noSession ? false : profile?.id === "omp" || !turnActive;
  const modelTitle = !noSession && modelClickable
    ? t("点击发送 /model 打开 CLI 模型选择")
    : turnActive
      ? t("对话进行中,本轮结束后可点击切换模型")
      : (status?.model ?? t("未识别模型"));

  /** 模型位点击 = 发送 /model(与抽屉 send 同路径:prepareSendPayload → writeSession)。 */
  function sendModelCommand(): void {
    sendSlash("/model");
  }
  /** 思考位点击 = 发送 profile.thinkingCommand(如 dsh /effort);缺省不渲染可点。 */
  function sendThinkingCommand(): void {
    if (profile?.thinkingCommand) sendSlash(profile.thinkingCommand);
  }
  function sendSlash(cmd: string): void {
    if (!sessionId || !profile) return;
    const wire = prepareSendPayload(profile, cmd);
    host.writeSession(sessionId, wire);
    /* 不广播 promptSent:/model 与思考命令是 CLI 控制命令,永不开对话轮;起锚只会
       空耗轮次号 —— 轮中切模型曾把在途轮 19 个文件错归 "/model" 批(2026-09-08 实证) */
  }
  const drawerOpen = useDrawerOpen();
  const stage = useComposerStage();

  const iconBtn =
    "grid h-6 w-6 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-(--tmd-border) px-2 text-[0.6875rem] leading-none text-(--tmd-fg-muted) select-none">
      <button
        className={`flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors ${
          modelClickable
            ? "cursor-pointer hover:bg-(--tmd-bg-hover)"
            : "disabled:cursor-not-allowed disabled:opacity-40"
        }`}
        disabled={!modelClickable}
        title={modelTitle}
        onClick={sendModelCommand}
      >
        <span aria-hidden>{t("模型")}</span>
        <span className="font-mono text-(--tmd-fg)">{status?.model ?? "—"}</span>
        {seeded && status?.model ? (
          <span
            aria-label={t("默认模型(尚未读到会话实况)")}
            title={t("来自 CLI 默认配置,尚未读到会话实况")}
            className="rounded-sm bg-(--tmd-bg-hover) px-1 text-[0.625rem] text-(--tmd-fg-muted)"
          >
            {t("默认")}
          </span>
        ) : null}
      </button>
      <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
      {profile?.thinkingCommand ? (
        <button
          className={`flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors ${
            !turnActive ? "cursor-pointer hover:bg-(--tmd-bg-hover)" : "cursor-not-allowed opacity-40"
          }`}
          disabled={turnActive}
          title={turnActive ? t("对话进行中,本轮结束后可点击") : t("点击打开思考强度选择")}
          onClick={sendThinkingCommand}
        >
          <span aria-hidden>{t("思考")}</span>
          <span className="font-mono text-(--tmd-fg)">{status?.thinkingLevel ?? "—"}</span>
        </button>
      ) : (
        <span className="flex items-center gap-1" title={status?.thinkingLevel ?? t("未识别思考强度")}>
          <span aria-hidden>{t("思考")}</span>
          <span className="font-mono text-(--tmd-fg)">{status?.thinkingLevel ?? "—"}</span>
        </span>
      )}
      {sessionId ? (
        <>
          <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
          <QuotaChip />
        </>
      ) : null}
      {/* 五段式对话框高度:↑ 逐级展开 / ↓ 逐级收起(min → collapsed → compact → normal → expanded),AppShell resize composer Panel */}
      <button
        type="button"
        title={t("展开对话框")}
        aria-label={t("展开对话框")}
        onClick={expandComposerStage}
        className={`${iconBtn} ml-auto text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}
      >
        <CaretUp size="0.9375rem" />
      </button>
      <button
        type="button"
        title={t("收起对话框")}
        aria-label={t("收起对话框")}
        disabled={noSession || stage === "min"}
        onClick={collapseComposerStage}
        className={`${iconBtn} text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}
      >
        <CaretDown size="0.9375rem" />
      </button>
      {/* 命令抽屉直达开关(closed ↔ open);原「只读」占位(openspec/changes/composer-command-drawer) */}
      <button
        type="button"
        aria-expanded={drawerOpen}
        aria-controls="command-drawer"
        title={t("命令与技能(⌘K)")}
        disabled={noSession}
        onClick={(e) => { e.stopPropagation(); toggleDrawer(); }}
        className={`${iconBtn} ${
          drawerOpen
            ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
            : "text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        }`}
      >
        <Sidebar size="0.9375rem" />
      </button>
    </div>
  );
}