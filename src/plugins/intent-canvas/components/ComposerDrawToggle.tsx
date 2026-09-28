/**
 * Composer 左下作图标识 —— 本会话 AI 作画开关(意图画布插件贡献给
 * composer.inputRail 挂点;assets WakeIcons 同区)。
 *
 * 开 = 本会话每条发送注入作画指令段(AI 写 inbox 文件 → 画布轮询导入);
 * 关(默认) = 普通发送,零注入。全局总闸(设置页)关闭时整个按钮不渲染。
 */

import { useEffect } from "react";
import { t } from "@kernel/i18n";
import { host, useHost } from "@kernel/host";
import { Compass } from "@phosphor-icons/react";
import { useAiDrawEnabled, useSessionDrawMode, toggleSessionDrawMode } from "../aiDrawStore";
import { aiDrawInboxPath } from "../aiDraw";
import { cacheAiDrawInboxPath } from "../aiDrawPrompt";
import { getActiveWorkspace } from "@kernel/workspace";

export function ComposerDrawToggle() {
  const hostTick = useHost();
  void hostTick;
  const globalEnabled = useAiDrawEnabled();
  const sessionId = host.getActiveSessionId();
  const active = useSessionDrawMode(sessionId);

  if (!globalEnabled || !sessionId) {
    return null;
  }

  /* 工作区切换时图标仍亮但缓存按 root 键控会 miss:跟随激活 root 补预热,
     保证「亮 = 下一条必注入」的表态可信(评审 P2)。 */
  const root = getActiveWorkspace()?.root;
  useEffect(() => {
    if (active && root) {
      void aiDrawInboxPath(root).then((inbox) => cacheAiDrawInboxPath(root, inbox));
    }
  }, [active, root]);

  const toggle = () => {
    const next = !active;
    toggleSessionDrawMode(sessionId, next);
    if (next) {
      /* 开启即预热 inbox 路径缓存:发送线程是同步读缓存,不依赖画布 tab
         打开过(configHomeDir 是异步 IPC,首次点击时补算,下一条消息必注入)。 */
      const root = getActiveWorkspace()?.root;
      if (root) {
        void aiDrawInboxPath(root).then((inbox) => cacheAiDrawInboxPath(root, inbox));
      }
    }
  };

  return (
    <button
      type="button"
      className={`inline-flex size-6 cursor-pointer items-center justify-center rounded-md border text-[0.65rem] transition-colors ${
        active
          ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-accent)"
          : "border-transparent text-(--tmd-fg-subtle) hover:text-(--tmd-fg)"
      }`}
      onClick={toggle}
      aria-pressed={active}
      aria-label={active ? t("本会话 AI 作画:开") : t("本会话 AI 作画:关")}
      title={active
        ? t("本会话 AI 作画:开(发送时附带作画指令,点击关闭)")
        : t("本会话 AI 作画:关(点击开启,本会话发送将让 AI 画进意图画布)")}
    >
      <Compass aria-hidden className="size-3.5" weight={active ? "fill" : "regular"} />
    </button>
  );
}
