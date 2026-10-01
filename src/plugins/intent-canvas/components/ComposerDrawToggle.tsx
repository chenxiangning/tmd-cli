/**
 * Composer 左下作图标识 —— 本会话 AI 作画开关(意图画布插件贡献给
 * composer.inputRail 挂点;assets WakeIcons 同区)。
 *
 * 开 = 本会话每条发送注入作画指令段(AI 写 inbox 文件 → activate 级轮询导入);
 * 关(默认) = 普通发送,零注入。全局总闸(设置页)关闭时整个按钮不渲染。
 * 另兼导入成功 toast 面:轮询导入发布通知,此处滑出「已上画布」提示。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { host, useHost } from "@kernel/host";
import { Compass } from "@phosphor-icons/react";
import { DecorIcon } from "@kernel/iconSet";
import { useAiDrawEnabled, useSessionDrawMode, useAiDrawImportNotice, toggleSessionDrawMode } from "../aiDrawStore";
import { aiDrawInboxPath } from "../aiDraw";
import { cacheAiDrawInboxPath } from "../aiDrawPrompt";
import { loadIntentCanvasIndex } from "../storage/documents";
import { getActiveWorkspace } from "@kernel/workspace";

export function ComposerDrawToggle() {
  const hostTick = useHost();
  void hostTick;
  const globalEnabled = useAiDrawEnabled();
  const sessionId = host.getActiveSessionId();
  const active = useSessionDrawMode(sessionId);
  const root = getActiveWorkspace()?.root;

  /* 工作区切换时图标仍亮但缓存按 root 键控会 miss:跟随激活 root 补预热,
     保证「亮 = 下一条必注入」的表态可信(评审 P2)。hook 必须先于 early return。 */
  useEffect(() => {
    if (active && root) {
      void aiDrawInboxPath(root).then((inbox) => cacheAiDrawInboxPath(root, inbox));
      /* 作画缺省目标 = 最近更新画布:补读索引暖目标缓存(storage 读后自喂),
         下一条注入即指向既有画布而非另开新图。 */
      void loadIntentCanvasIndex(root);
    }
  }, [active, root]);

  /* 开关上方滑出提示(与广播同款节奏,2.2s 自隐) */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((message: string, ttlMs = 2200) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ttlMs);
  }, []);

  /* 导入成功通知(activate 级轮询发布,aiDrawPoller):本组件常驻 composer
     输入轨,是聚焦态下插件可用的最小侵入 toast 面(composer-rail-toast 先例)。 */
  const importNotice = useAiDrawImportNotice();
  const noticedSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!importNotice) {
      return;
    }
    if (noticedSeq.current === null) {
      noticedSeq.current = importNotice.seq; /* 挂载快照不算新导入 */
      return;
    }
    if (noticedSeq.current === importNotice.seq) {
      return;
    }
    noticedSeq.current = importNotice.seq;
    showToast(
      `${t("AI 作画已上画布:")}${importNotice.canvases.map((canvas) => canvas.title).join(", ")}`,
      3200,
    );
  }, [importNotice, showToast]);

  if (!globalEnabled || !sessionId) {
    return null;
  }

  const toggle = () => {
    const next = !active;
    toggleSessionDrawMode(sessionId, next);
    /* 开关即上方滑出提示(与广播开关同款,2026-09-28 真机反馈);文案如实:
       结果自动导入画布,导入成功有通知(rail toast / 失焦 OS 通知)。 */
    showToast(next ? t("作画已开启:AI 作画结果将自动导入画布并通知") : t("作画已关闭"));
    if (next && root) {
      /* 开启即预热 inbox 路径缓存:发送线程是同步读缓存,不依赖画布 tab
         打开过(configHomeDir 是异步 IPC,首次点击时补算,下一条消息必注入)。 */
      void aiDrawInboxPath(root).then((inbox) => cacheAiDrawInboxPath(root, inbox));
      void loadIntentCanvasIndex(root);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`relative inline-flex size-6 cursor-pointer items-center justify-center rounded-md border p-0 text-[0.65rem] transition-colors ${
          active
            ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-accent)"
            : "border-(--tmd-border) bg-(--tmd-bg-elevated) text-(--tmd-fg-faint) hover:text-(--tmd-accent) hover:border-(--tmd-accent)"
        }`}
        onClick={toggle}
        aria-pressed={active}
        aria-label={active ? t("本会话 AI 作画:开") : t("本会话 AI 作画:关")}
        title={active
          ? t("本会话 AI 作画:开(发送时附带作画指令,点击关闭)")
          : t("本会话 AI 作画:关(点击开启,本会话发送将让 AI 画进意图画布)")}
      >
        <DecorIcon id="ai-draw" Fallback={Compass} aria-hidden className="size-3.5" weight={active ? "fill" : "regular"} data-action-id="ai-draw" />
      </button>
      {toast && (
        <div className="composer-rail-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
