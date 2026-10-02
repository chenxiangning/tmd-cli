/**
 * AI 作画 inbox 常驻轮询(插件 activate 级,2026-10 审计修复:脱离画布 tab
 * 挂载周期 —— tab 关着 AI 写的指令文件也 2s 内导入,不再要求先开一次画布)。
 *
 * 每 2s 扫激活工作区 inbox(无 fs watch 原语,ponytail 同前);画布 tab 开着时
 * 由 useAiDrawInbox 订阅 notice 保持原刷新行为。导入成功的用户可见通知:
 * - 聚焦:composer rail toast(ComposerDrawToggle 订阅同一 store,TileBroadcast
 *   同款 toast 样式);
 * - 失焦:OS 系统通知(kernel sendOsNotification,notify 插件同通道),
 *   点击深链直达画布(openIntentCanvasBacklink)。
 * 总闸(aiDrawPref)关闭即停扫:AI 不再写 inbox,轮询无意义(评审 P2 语义)。
 */

import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { sendOsNotification } from "@kernel/ipc";
import { getActiveWorkspace } from "@kernel/workspace";
import { openIntentCanvasBacklink } from "./activeDocumentBridge";
import { aiDrawInboxPath, pollAiDrawInbox } from "./aiDraw";
import { cacheAiDrawInboxPath } from "./aiDrawPrompt";
import {
  aiDrawPref,
  publishAiDrawImport,
  setAiDrawPollError,
  type AiDrawImportedCanvas,
} from "./aiDrawStore";

export const AI_DRAW_POLL_MS = 2000;

let timer: number | null = null;
let running = false;

function notifyImported(imported: AiDrawImportedCanvas[]): void {
  /* 聚焦时 rail toast 与画布 tab 横幅已可见,OS 通知只打扰;失焦才发。 */
  if (host.isWindowFocused()) {
    return;
  }
  const body = imported.map((canvas) => canvas.title).join(", ");
  void sendOsNotification(
    t("AI 作画"),
    `${t("AI 作画已上画布:")}${body}`,
    () => openIntentCanvasBacklink(imported[0].id),
  );
}

async function tick(): Promise<void> {
  /* in-flight 闸:慢盘上单轮超过 2s 时跳过本轮,防同一批文件重复导入
     (aiDrawImport 另有模块级 pollInFlight 双保险)。 */
  if (running) {
    return;
  }
  running = true;
  try {
    const workspace = getActiveWorkspace();
    if (!workspace || !aiDrawPref().enabled) {
      return;
    }
    /* 顺热 inbox 路径缓存:sendTransform 同步读它决定是否注入作画指令。 */
    const inbox = await aiDrawInboxPath(workspace.root).catch(() => null);
    if (inbox) {
      cacheAiDrawInboxPath(workspace.root, inbox);
    }
    const imported = await pollAiDrawInbox(workspace.root, {
      id: workspace.id,
      name: workspace.name,
    });
    setAiDrawPollError(null);
    if (imported.length > 0) {
      publishAiDrawImport(imported);
      notifyImported(imported);
    }
  } catch (error) {
    setAiDrawPollError(error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

/** 插件 activate 调用;返回停止函数交生命周期账本(熔断/停用即停扫)。 */
export function startAiDrawInboxPoller(): () => void {
  /* node 契约测试(tabContent.contract)以最小 window 桩激活全量插件,无定时器
     原语:退化为不轮询(真机 webview 恒有;首轮 void tick 无工作区即空转)。 */
  if (timer !== null || typeof window === "undefined" || typeof window.setInterval !== "function") {
    return () => undefined;
  }
  void tick();
  timer = window.setInterval(() => void tick(), AI_DRAW_POLL_MS);
  return () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}
