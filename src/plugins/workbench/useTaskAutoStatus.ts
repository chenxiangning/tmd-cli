/**
 * 工作台 · 任务状态自动纳管:关联会话运行中 → 任务 todo 自动推进 doing。
 * 活状态唯一来源 = host 会话注册表(host link 的 ref 是会话 id,disk link 的
 * ref 是 CLI 磁盘身份);只进不退 —— doing/done 不受影响(回退靠手动,AI 交付
 * 置 done 走 AI-TASKS.md 磁盘回写)。选择器在 views.ts(pendingAutoDoing)。
 * 挂在 WorkbenchTab 与 ProjectTab(均 keepAlive):打开过即常驻订阅,会话
 * 开/关/恢复实时生效。
 */

import { useEffect, useSyncExternalStore } from "react";
import { host, useHost } from "@kernel/host";
import { subscribeWorkbench, workbenchSnapshot, updateTask } from "./store";
import { pendingAutoDoing } from "./views";

/** 订阅式自动纳管(无渲染输出);写失败静默(横幅错误已进 store.error)。 */
export function useTaskAutoStatus(): void {
  const hostVersion = useHost();
  const projects = useSyncExternalStore(subscribeWorkbench, workbenchSnapshot);
  useEffect(() => {
    const live = new Set<string>();
    for (const session of host.getSessions()) {
      live.add(session.id);
      if (session.cliSessionId) live.add(session.cliSessionId);
    }
    for (const { projectId, taskId } of pendingAutoDoing(projects, live)) {
      void updateTask(projectId, taskId, { status: "doing" }).catch(() => undefined);
    }
  }, [projects, hostVersion]);
}
