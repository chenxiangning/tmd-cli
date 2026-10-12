/**
 * 工作台 · 由会话 link 打开会话(任务详情弹层与项目详情「会话」页签共一条
 * 打开路径;纯 host 动作无 JSX,独立成文件以满足 only-export-components)。
 */

import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import type { Project, ProjectTask } from "./types";
import type { ProjectSessionsState } from "./useProjectSessions";

/** 死关联找回:旧关联(host 版 < cliSessionId 回写机制)没存磁盘身份。
 *  判据 = 绑定 cwd 的磁盘会话 + 创建时刻邻近(±5min,spawn≈link 时刻);
 *  任务标题对会话标题几乎必不命中(CLI 命名),不作判据。邻近命中唯一才
 *  自动 resume,多候选即歧义,不赌——如实提示从侧栏手动打开。 */
function recoverDeadLink(
  link: ProjectTask["sessions"][number],
  project: Project,
  workspaceId: string | undefined,
  recent: ProjectSessionsState | null | undefined,
  onToast: (m: string) => void,
): void {
  const at = Date.parse(link.createdAt);
  const near = (recent?.rows ?? []).filter((r) =>
    r.disk.createdAt !== undefined && Math.abs(r.disk.createdAt - at) <= 5 * 60_000,
  );
  if (near.length === 1 && project.cwd) {
    const cand = near[0];
    void host.openDiskSession(cand.profileId, project.cwd, workspaceId, cand.cliSessionId).then(
      () => undefined,
      () => onToast(t("打开会话失败")),
    );
    return;
  }
  onToast(near.length > 1
    ? t("未找到原会话,请从侧栏手动打开")
    : t("会话已结束,可从列表移除后重新关联"));
}

/** host 活会话先查注册表(已关 tab/被移除的 ref setActiveSession 是静默无效,
 *  必须先验存活),兜底磁盘恢复;disk 直接恢复。workspaceId 必传口径:不带
 *  工作区 id 的会话是孤儿,侧栏工作区树与运行时都不收。成功即收工作台覆盖层
 *  —— 用户落回侧栏会话,闭环(盖着看不到等于没打开)。 */
export function openLink(
  link: ProjectTask["sessions"][number],
  project: Project,
  workspaceId: string | undefined,
  onToast: (m: string) => void,
  recent?: ProjectSessionsState | null,
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
     * 见 TaskDetailView 的 bindTaskSessionDiskId);无身份(旧关联/未绑定
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
    recoverDeadLink(link, project, workspaceId, recent, onToast);
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

/** 「在此目录开新会话」公共动作(项目详情会话页签与聚焦页脉搏行共一条路径):
 *  引擎档位取该目录最近会话的 profile;三分 null=扫描中 / 空=真空或扫描失败 /
 *  有=直接建。创建即声明「要看会话」并聚焦。onSettled 必调(调用方解禁用态)。 */
export function createSessionHere(
  project: Project,
  workspaceId: string | undefined,
  recent: ProjectSessionsState | null,
  onToast: (m: string) => void,
  onSettled: () => void,
): void {
  if (!project.cwd) {
    onSettled();
    return;
  }
  if (recent === null) {
    onToast(t("正在扫描本地会话…"));
    onSettled();
    return;
  }
  if (recent.rows.length === 0) {
    onToast(recent.failed
      ? t("引擎会话扫描失败,列表可能不全。")
      : t("该目录暂无可用引擎会话,请先在侧栏开过一次"));
    onSettled();
    return;
  }
  void host.createSession(recent.rows[0].profileId, project.cwd, workspaceId).then(
    (meta) => {
      host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
      host.setActiveSession(meta.id);
      onSettled();
    },
    () => {
      onToast(t("创建会话失败"));
      onSettled();
    },
  );
}
