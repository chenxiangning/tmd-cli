/**
 * 工作台 · 任务维度结算守望(一期闭环,2026-11-06):
 * 只通知、不写 status——状态权威在 AI 手(AI-TASKS.md 直改 index.json)与用户
 * 手势(状态选择/驳回回滚),客户端双写必打架。
 * ① doing→review 外部迁移(AI 回写「交付待验收」,storeWatch 轮询到后diff)
 *    → OS 通知「任务待验收」;
 * ② 关联 host 会话退出而任务仍开放 → OS 通知(重派线索)。
 * 通知闸复用 notify 插件 shouldNotify(turnEnd/exit 档),不新设设置项;
 * 点击通知 = 打开工作台(任务深链二期接 wbDeepLink)。
 */
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { t } from "@kernel/i18n";
import { sendOsNotification } from "@kernel/ipc";
import type { PluginEventBus } from "@kernel/plugin";
import { getSettingsState } from "@kernel/settings";
import { shouldNotify } from "@plugins/notify/logic";
import { ensureWorkbenchLoaded, workbenchSnapshot } from "./store";
import { openWorkbenchTab } from "./wbTabs";
import { isTaskOpen, type Project, type ProjectTask } from "./types";

/** 外部快照 diff:doing/todo → review 的任务集(纯函数,测试面)。 */
export function tasksEnteringReview(
  before: readonly Project[],
  after: readonly Project[],
): { projectId: string; task: ProjectTask }[] {
  const out: { projectId: string; task: ProjectTask }[] = [];
  const prevById = new Map(before.map((b) => [b.id, b]));
  for (const p of after) {
    const prevStatus = new Map((prevById.get(p.id)?.tasks ?? []).map((x) => [x.id, x.status]));
    for (const task of p.tasks) {
      if (task.status !== "review" || prevStatus.get(task.id) === "review") continue;
      out.push({ projectId: p.id, task });
    }
  }
  return out;
}

/** 快照迁移 → 通知(storeWatch 在外部回写整载后调用;before 为载前内存快照)。 */
export function notifyExternalTaskTransitions(before: readonly Project[], after: readonly Project[]): void {
  const { settings } = getSettingsState();
  if (!shouldNotify("turnEnd", settings, host.isWindowFocused(), settings)) return;
  for (const { task } of tasksEnteringReview(before, after)) {
    void sendOsNotification(t("任务待验收"), t("「{title}」已自检并交付待验收", { title: task.title }), openWorkbenchTab);
  }
}

/** sessionId → 仍开放(未 done/cancelled)且关联该 host 会话的任务(纯函数,测试面)。 */
export function findOpenTaskByHostSession(
  sessionId: string,
  projects: readonly Project[],
): { projectId: string; task: ProjectTask } | null {
  for (const p of projects) {
    for (const task of p.tasks) {
      if (!isTaskOpen(task)) continue;
      if (task.sessions.some((link) => link.kind === "host" && link.ref === sessionId)) return { projectId: p.id, task };
    }
  }
  return null;
}

/** activate 装配:会话退出 → 开放任务异常通知(退订随插件 deactivate)。 */
export function bootTaskExitWatch(events: PluginEventBus): () => void {
  return events.on<string>(KernelTopics.sessionExited, (sessionId) => {
    void ensureWorkbenchLoaded()
      .then(() => {
        const hit = findOpenTaskByHostSession(sessionId, workbenchSnapshot());
        if (!hit) return;
        const { settings } = getSettingsState();
        if (!shouldNotify("exit", settings, host.isWindowFocused(), settings)) return;
        void sendOsNotification(t("任务会话退出"), t("「{title}」未完成,关联会话已退出", { title: hit.task.title }), openWorkbenchTab);
      })
      .catch(() => undefined);
  });
}
