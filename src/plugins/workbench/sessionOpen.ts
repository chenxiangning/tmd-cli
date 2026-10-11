/**
 * 工作台 · 由会话 link 打开会话(任务详情弹层与项目详情「会话」页签共一条
 * 打开路径;纯 host 动作无 JSX,独立成文件以满足 only-export-components)。
 */

import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import type { Project, ProjectTask } from "./types";

/** host 活会话先查注册表(已关 tab/被移除的 ref setActiveSession 是静默无效,
 *  必须先验存活),兜底磁盘恢复;disk 直接恢复。workspaceId 必传口径:不带
 *  工作区 id 的会话是孤儿,侧栏工作区树与运行时都不收。成功即收工作台覆盖层
 *  —— 用户落回侧栏会话,闭环(盖着看不到等于没打开)。 */
export function openLink(
  link: ProjectTask["sessions"][number],
  project: Project,
  workspaceId: string | undefined,
  onToast: (m: string) => void,
): void {
  /* 调用方均为用户点击行(任务详情/项目详情会话列表):先声明「要看会话」,
   * app-shell 摘最大化让幕布可见(见 kernel/events.ts sessionViewRequested 红线)。 */
  host.events.emit(KernelTopics.sessionViewRequested, null);
  if (link.kind === "host") {
    if (host.getSessions().some((s) => s.id === link.ref)) {
      host.setActiveSession(link.ref);
      return;
    }
    /* 会话已结束:优先用关联时留存的 CLI 磁盘身份 resume(运行期绑定回写,
     * 见 TaskDetailDialog 的 bindTaskSessionDiskId);无身份(旧关联/未绑定
     * 即终结)不猜测,提示重关联。 */
    if (link.cliSessionId && project.cwd) {
      void host.openDiskSession(link.profileId, project.cwd, workspaceId, link.cliSessionId).then(
        () => undefined,
        () => onToast(t("打开会话失败")),
      );
      return;
    }
    const cliSessionId = host.getCliSessionId(link.ref);
    if (cliSessionId && project.cwd) {
      void host.openDiskSession(link.profileId, project.cwd, workspaceId, cliSessionId).then(
        () => undefined,
        () => onToast(t("打开会话失败")),
      );
      return;
    }
    onToast(t("会话已结束,可从列表移除后重新关联"));
    return;
  }
  if (!project.cwd) {
    onToast(t("项目未绑定目录,无法恢复磁盘会话"));
    return;
  }
  void host.openDiskSession(link.profileId, project.cwd, workspaceId, link.ref).then(
    () => undefined,
    () => onToast(t("打开会话失败")),
  );
}
