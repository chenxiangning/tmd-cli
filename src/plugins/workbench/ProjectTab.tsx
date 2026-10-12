/**
 * 工作台 · 项目详情中央 tab 内容(kind "wb.project",activate 期注册)。
 * payload.projectId → live 快照解析;项目已删渲染空态不保活旧数据。
 * 编辑/建任务/文档预览弹层全部内聚在本组件(ProjectDetail 自理)。
 */

import { useEffect, useState, useSyncExternalStore } from "react";
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
  useEffect(() => {
    /* toast 与主页同口径 2600ms 自动清除,不永驻页底。 */
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(timer);
  }, [message]);
  const payload = tab.payload as { projectId?: string; focusTab?: string } | null;
  const [lastPayload, setLastPayload] = useState(payload);
  /* 深链:openProjectTab 带 refresh 换 payload 重开已存在 tab → focusTab 到达即
   * 切换(渲染期调整;计数器驱动 key 重挂让 ProjectDetail 重新吃 initialTab)。 */
  const [focusSeq, setFocusSeq] = useState(0);
  if (lastPayload !== payload) {
    setLastPayload(payload);
    if (payload?.focusTab) setFocusSeq((n) => n + 1);
  }
  const projectId = payload?.projectId ?? "";
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return <WbEmpty text={t("项目不存在或已删除。")} />;
  }
  return (
    <div className="wb-project-tab">
      <ProjectDetail
        key={focusSeq}
        project={project}
        onToast={(text) => setMessage(text)}
        initialTab={payload?.focusTab as DrawerTab | undefined}
      />
      {message ? <div className="wb-toast" role="status">{message}</div> : null}
    </div>
  );
}
