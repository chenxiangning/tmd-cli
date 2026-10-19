/**
 * 新建会话菜单 · 会话预设段(workspace 插件 · 候选4):行点击 = 按预设一键
 * 起会话(spawn 成功后经 kernel pending 队列注入初始提示词,契约见
 * presetLaunch)。引用失效/引擎不可用/候选空行灰态禁点,tooltip 如实说明,
 * 不猜测不静默。仅本地工作区渲染(!origin 同 worktree 项先例,入口在 SessionMenu)。
 */

import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { KernelTopics, type SessionStartFailedEvent } from "@kernel/events";
import { setPendingPrompt } from "@kernel/sessionPending";
import type { Workspace } from "@kernel/workspace";
import { Play, SlidersHorizontal } from "@phosphor-icons/react";
import { promptContent } from "@plugins/assets/promptStore";
import { defaultEngineCandidates } from "@plugins/workbench/defaultEngine";
import { launchPresetSession, launchPresetWorktreeSession } from "./presetLaunch";
import { runWorktreeCreate } from "./worktreeCreate";
import { presetPromptText, useSessionPresets, type SessionPreset } from "./sessionPresets";

/* 行内 pill / 描述:菜单行信息密度对齐候选4 定稿(名称行 + pill,次行说明)。 */
const pillCls =
  "shrink-0 rounded-full border border-(--tmd-border) px-1.5 text-[0.6875rem] font-normal leading-4 text-(--tmd-fg-subtle)";
const descCls = "truncate text-xs font-normal text-(--tmd-fg-subtle)";

/** 行禁点原因(tooltip);null = 可点。引擎候选空全局禁;单体按引擎/提示词失效判。 */
function presetBlockReason(
  preset: SessionPreset,
  engineCount: number,
  contentOf: (name: string) => string,
): string | null {
  if (engineCount === 0) return t("未检测到可用引擎,无法启动预设");
  if (!host.getCliProfile(preset.engineId)) return t("预设的引擎不可用");
  if (preset.prompt && !("text" in preset.prompt) && !presetPromptText(preset, contentOf).trim()) {
    return t("预设引用的提示词不存在或不可用");
  }
  return null;
}

/** 菜单里的预设段:恒显(本地工作区);空库给引导,管理入口固定在尾行。 */
export function SessionMenuPresets({
  workspace,
  onManage,
  onClose,
}: {
  workspace: Workspace;
  /** 「管理预设…」:弹层归调用方持有(菜单卸载不连带杀弹层)。 */
  onManage: () => void;
  onClose: () => void;
}) {
  const { presets } = useSessionPresets();
  const engineCount = defaultEngineCandidates().length;
  const contentOf = (name: string) => promptContent(name, workspace.root);

  const launch = (preset: SessionPreset) => {
    if (presetBlockReason(preset, engineCount, contentOf)) return;
    const profile = host.getCliProfile(preset.engineId);
    if (!profile) return;
    /* 用户手势惯例:摘最大化让幕布可见(引擎行/worktree 同款)。spawn 被拒的
     * 原因已由内核广播 sessionStartFailed(StartFailureToast 呈现),此处吞 rejection。 */
    host.events.emit(KernelTopics.sessionViewRequested, null);
    onClose();
    const promptText = presetPromptText(preset, contentOf);
    if (preset.worktree) {
      /* 范围 = 新 worktree:一键无对话框,失败经 startFailed 广播呈现(wtCreateOutcomeMessage 文案)。 */
      const failed: SessionStartFailedEvent = { sessionId: null, profileId: profile.id, reason: "" };
      void launchPresetWorktreeSession({
        profileId: profile.id,
        name: preset.name,
        workspaceRoot: workspace.root,
        args: profile.args ?? [],
        env: profile.env ?? {},
        modelArg: profile.modelArg,
        model: preset.model,
        promptText,
        deps: {
          gitInfo: async (cwd) => {
            const [wt, br] = await Promise.allSettled([ipc.gitWorktreeList(cwd), ipc.gitBranches(cwd)]);
            if (wt.status === "rejected") return null; /* 非 git 仓(NotGit 前置拦截同款) */
            return {
              takenBranches: wt.value.map((e) => e.branch).filter(Boolean),
              localBranches: br.status === "fulfilled" ? br.value.local.map((b) => b.name) : [],
            };
          },
          create: runWorktreeCreate,
          startFailed: (reason) => host.events.emit(KernelTopics.sessionStartFailed, { ...failed, reason }),
        },
      });
      return;
    }
    void launchPresetSession({
      profileId: profile.id,
      command: profile.command,
      args: profile.args ?? [],
      env: profile.env ?? {},
      modelArg: profile.modelArg,
      model: preset.model,
      cwd: workspace.root,
      title: preset.name,
      promptText,
      deps: {
        spawn: (spec) => host.spawnRawSession(profile.id, spec, workspace.id, { identityTrack: true }),
        setPendingPrompt,
      },
    }).then(() => undefined);
  };

  return (
    <>
      <div className="wsmenu-divider" />
      <div className="wsmenu-group-title">{t("会话预设")}</div>
      {presets.length === 0 && (
        <div className="wsmenu-note">{t("暂无预设,点下方「管理预设…」创建")}</div>
      )}
      {presets.map((preset) => {
        const reason = presetBlockReason(preset, engineCount, contentOf);
        const profile = host.getCliProfile(preset.engineId);
        const ref = preset.prompt && !("text" in preset.prompt) ? preset.prompt.ref : null;
        const inlineText = preset.prompt && "text" in preset.prompt ? preset.prompt.text : "";
        return (
          <button
            key={preset.id}
            className="wsmenu-item"
            disabled={reason !== null}
            title={reason ?? undefined}
            onClick={() => launch(preset)}
          >
            <span className="wsmenu-item-icon">
              <Play size="0.8125rem" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate">{preset.name}</span>
                {preset.worktree && <span className={pillCls}>{t("新 worktree")}</span>}
                {ref && <span className={`${pillCls} truncate`}>{t("引用「{name}」", { name: ref.name })}</span>}
              </span>
              <span className={descCls}>
                {ref ? t("消费时现读,库更新即跟随") : inlineText || t("无初始提示词")}
              </span>
            </span>
            {profile && <span className="wsmenu-item-kbd">{profile.name}</span>}
          </button>
        );
      })}
      <button
        className="wsmenu-item"
        onClick={() => {
          onClose();
          onManage();
        }}
      >
        <span className="wsmenu-item-icon">
          <SlidersHorizontal size="0.8125rem" />
        </span>
        <span className="wsmenu-item-label">{t("管理预设…")}</span>
      </button>
    </>
  );
}
