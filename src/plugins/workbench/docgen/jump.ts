/**
 * docgen 溯源跳转 hook(自 DocGenReader 拆出守 300 行铁则;hook 状态面 =
 * 全项目范围判定所需的界面语言无关纯查询)。
 * spec:进展→项目详情「进展」页签(focusTab);日志→工作日志文章 tab;
 * 会话→标题匹配绑定目录最近会话后 openDiskSession 磁盘恢复;提交 sha 留 P3。
 * 跳转不到(全部项目范围/无匹配)toast 说明,不猜。
 */
import { t } from "@kernel/i18n";
import { useWorkspaces } from "@kernel/workspace";
import type { Project } from "../types";
import type { DocGenEntry } from "./types";
import { openArticleTab } from "../journal/journalTabs";
import { openProjectTab } from "../wbTabs";
import { useProjectSessions } from "../useProjectSessions";
import { openLink } from "../sessionOpen";
import { resolveWorkspaceId } from "../views";

export function useDocGenJump(entry: DocGenEntry, projects: readonly Project[], onToast: (m: string) => void): (src: string) => void {
  const { list: workspaces } = useWorkspaces();
  const scope = entry.scope;
  const jumpProject = scope.kind === "one" ? projects.find((p) => p.id === scope.projectId) ?? null : null;
  const recentSessions = useProjectSessions(jumpProject?.cwd);
  return (src: string) => {
    let m = /^日志 (\d{4})-(\d{2})-(\d{2})$/.exec(src.trim());
    if (m) {
      openArticleTab(Number(m[1]), Number(m[2]), Number(m[3]));
      return;
    }
    m = /^进展 (\d{4})-(\d{2})-(\d{2})$/.exec(src.trim());
    if (m) {
      if (jumpProject) {
        openProjectTab(jumpProject.id, jumpProject.name, "updates");
        return;
      }
      onToast(t("进展溯源跳转需单项目范围(当前为全部项目)"));
      return;
    }
    m = /^会话 (.+)$/.exec(src.trim());
    if (m) {
      if (!jumpProject) {
        onToast(t("会话溯源跳转需单项目范围(当前为全部项目)"));
        return;
      }
      const frag = m[1].trim();
      const row = (recentSessions?.rows ?? []).find((r) => r.title.includes(frag) || frag.includes(r.title));
      if (!row) {
        onToast(t("溯源:{src}:未找到匹配会话(可能已清理)", { src }));
        return;
      }
      openLink(
        { ref: row.cliSessionId, kind: "disk", profileId: row.profileId, title: row.title, cliSessionId: row.cliSessionId, createdAt: new Date().toISOString() },
        jumpProject,
        resolveWorkspaceId(workspaces, jumpProject.cwd),
        onToast,
        recentSessions,
      );
      return;
    }
    onToast(t("溯源:{src}(该来源类型暂不支持跳转)", { src }));
  };
}
