/**
 * 工作台 · 项目详情中央 tab 内容(kind "wb.project",activate 期注册)。
 * payload.projectId → live 快照解析;项目已删渲染空态不保活旧数据。
 * 编辑/建任务/文档预览弹层全部内聚在本组件(ProjectDetail 自理)。
 */

import { useState, useSyncExternalStore } from "react";
import { t } from "@kernel/i18n";
import type { EditorTab } from "@kernel/tabs";
import { subscribeWorkbench, workbenchSnapshot } from "./store";
import { ProjectDetail, type DrawerTab } from "./ProjectDetail";
import { useTaskAutoStatus } from "./useTaskAutoStatus";
import { WbEmpty } from "./ui";

export function ProjectTab({ tab }: { tab: EditorTab }) {
  const projects = useSyncExternalStore(subscribeWorkbench, workbenchSnapshot);
  useTaskAutoStatus();
  const [message, setMessage] = useState<string | null>(null);
  const payload = tab.payload as { projectId?: string; focusTab?: string } | null;
  const projectId = payload?.projectId ?? "";
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return <WbEmpty text={t("项目不存在或已删除。")} />;
  }
  const toast = (text: string) => setMessage(text);
  return (
    <div className="wb-project-tab">
      <ProjectDetail project={project} onToast={toast} initialTab={payload?.focusTab as DrawerTab | undefined} />
      {message ? <div className="wb-toast" role="status">{message}</div> : null}
    </div>
  );
}
