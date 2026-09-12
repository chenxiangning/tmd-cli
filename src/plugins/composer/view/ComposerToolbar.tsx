import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { collapseComposerStage, expandComposerStage, useComposerStage } from "@kernel/composerStage";
import { CaretDown, CaretUp, Sidebar } from "@phosphor-icons/react";
import { QuotaChip } from "./QuotaChip";
import { toggleDrawer, useDrawerOpen } from "../state/drawerOpen";
import { isRemoteEngineSession, useActiveProfile, useActiveSession } from "../state/useActiveProfile";
import { prepareSendPayload } from "../serialize/serialize";

/** 模型位:模型名 + seeded 徽标,点击发 /model(复杂度拆件)。
 *  远程引擎会话:本机配置种子不可信(那是本机 CLI 的模型,不是远端会话的),
 *  seeded 值一律不显示 —— 未观测到实况前显示「远程」。 */
function ModelSlot({
  model,
  seeded,
  remote,
  clickable,
  title,
  onSend,
}: {
  model: string | undefined;
  seeded: boolean;
  remote: boolean;
  clickable: boolean;
  title: string;
  onSend: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors ${
        clickable
          ? "cursor-pointer hover:bg-(--tmd-bg-hover)"
          : "disabled:cursor-not-allowed disabled:opacity-40"
      }`}
      disabled={!clickable}
      title={title}
      onClick={onSend}
    >
      <span aria-hidden>{t("模型")}</span>
      <span className="font-mono text-(--tmd-fg)">{model ?? (remote ? t("远程") : "—")}</span>
      {seeded && model ? (
        <span
          aria-label={t("默认模型(尚未读到会话实况)")}
          title={t("来自 CLI 默认配置,尚未读到会话实况")}
          className="rounded-sm bg-(--tmd-bg-hover) px-1 text-[0.625rem] text-(--tmd-fg-muted)"
        >
          {t("默认")}
        </span>
      ) : null}
    </button>
  );
}

/** 思考位:有 thinkingCommand 渲染按钮(轮中禁用),否则纯展示(复杂度拆件)。
 *  远程引擎会话:seeded 种子不显示(同模型位),未观测到实况前显示「远程」。 */
function ThinkingSlot({
  level,
  hasCommand,
  remote,
  turnActive,
  onSend,
}: {
  level: string | undefined;
  hasCommand: boolean;
  remote: boolean;
  turnActive: boolean;
  onSend: () => void;
}) {
  const display = level ?? (remote ? t("远程") : undefined);
  if (!hasCommand) {
    return (
      <span className="flex items-center gap-1" title={level ?? t("未识别思考强度")}>
        <span aria-hidden>{t("思考")}</span>
        <span className="font-mono text-(--tmd-fg)">{display ?? "—"}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors ${
        !turnActive ? "cursor-pointer hover:bg-(--tmd-bg-hover)" : "cursor-not-allowed opacity-40"
      }`}
      disabled={turnActive}
      title={turnActive ? t("对话进行中,本轮结束后可点击") : t("点击打开思考强度选择")}
      onClick={onSend}
    >
      <span aria-hidden>{t("思考")}</span>
      <span className="font-mono text-(--tmd-fg)">{display ?? "—"}</span>
    </button>
  );
}

/** 模型位可点性与标题(纯计算,拆出降复杂度):omp 随时可发 /model(其 TUI
 *  支持流中弹出模型选择);其余 CLI 对话进行中不可发(会串进输出流),等轮次
 *  结算(呼吸灯蓝态结束)才生效。 */
function modelClickState(
  noSession: boolean,
  turnActive: boolean,
): { clickable: boolean; title: string } {
  if (noSession) return { clickable: false, title: t("未识别模型") };
  if (turnActive) return { clickable: false, title: t("对话进行中,本轮结束后可点击切换模型") };
  return { clickable: true, title: t("点击发送 /model 打开 CLI 模型选择") };
}

/** 工具条右侧动作组:五段式高度 + 命令抽屉直达(自主组件拆出降复杂度)。 */
function ToolbarActions({
  noSession,
  drawerOpen,
  minimized,
}: {
  noSession: boolean;
  drawerOpen: boolean;
  minimized: boolean;
}) {
  const iconBtn =
    "grid h-6 w-6 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <>
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
        disabled={noSession || minimized}
        onClick={collapseComposerStage}
        className={`${iconBtn} text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)`}
      >
        <CaretDown size="0.9375rem" />
      </button>
      {/* 命令抽屉直达开关(closed ↔ open);原「只读」占位(openspec/changes/composer-command-drawer) */}
      <button
        type="button"
        aria-label={t("命令与技能(⌘K)")}
        aria-controls="command-drawer"
        title=""
        data-hint={t("命令与技能")}
        data-hint-cmd="composer.toggleDrawer"
        disabled={noSession}
        onClick={toggleDrawer}
        className={`${iconBtn} ${
          drawerOpen
            ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
            : "text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        }`}
      >
        <Sidebar size="0.9375rem" />
      </button>
    </>
  );
}

export function ComposerToolbar() {
  useHost();
  const sessionId = host.getActiveSessionId();
  const status = sessionId ? host.getSessionStatus(sessionId) : undefined;
  const statusSource = sessionId ? host.getSessionStatusSource(sessionId) : undefined;
  const seeded = statusSource === "seeded";
  /* seeded = 尚未读到会话实况,展示的是 CLI 默认配置种子(可能与会话实际生效值不符) */
  const noSession = !sessionId;
  const profile = useActiveProfile();
  const session = useActiveSession();
  /* 远程引擎会话(WSL CLI):本机种子的模型/思考是本机 CLI 配置,与远端会话无关 */
  const remoteEngine = isRemoteEngineSession(session);
  const observed = statusSource === "observed";
  const turnActive = sessionId ? host.isTurnActive(sessionId) : false;
  const { clickable: modelClickable, title: modelTitle } = modelClickState(noSession, turnActive);

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

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-(--tmd-border) px-2 text-[0.6875rem] leading-none text-(--tmd-fg-muted) select-none">
      <ModelSlot
        model={status?.model}
        seeded={seeded && !remoteEngine}
        remote={remoteEngine && !observed}
        clickable={modelClickable}
        title={modelTitle}
        onSend={sendModelCommand}
      />
      <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
      <ThinkingSlot
        level={remoteEngine && !observed ? undefined : status?.thinkingLevel}
        hasCommand={!!profile?.thinkingCommand}
        remote={remoteEngine && !observed}
        turnActive={turnActive}
        onSend={sendThinkingCommand}
      />
      {sessionId ? (
        <>
          <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
          <QuotaChip />
        </>
      ) : null}
      <ToolbarActions noSession={noSession} drawerOpen={drawerOpen} minimized={stage === "min"} />
    </div>
  );
}