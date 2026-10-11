/**
 * 工作台本页中央 tab(kind "wb.console",activate 期注册)。
 * 结构:顶栏(标题 + 问一句 + OverlayActions)→ 页签 + 七视图;
 * 详情弹层/表单/清空确认走 DialogShell 骨架。弹层自收,本组件不处理 Esc。
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { t } from "@kernel/i18n";
import { useWorkspaces } from "@kernel/workspace";
import { sortByRisk, todayISO } from "./analysis";
import { useTaskAutoStatus } from "./useTaskAutoStatus";
import { QUESTION_EXAMPLES, answerQuestion } from "./query";
import { clearAllProjects, createProject, ensureWorkbenchLoaded, subscribeWorkbench, updateProject, workbenchLoadError, workbenchSnapshot } from "./store";
import { linkableWorkspaces } from "./views";
import { WbConfirm } from "./ui";
import { ProjectFormModal, type ProjectFormValues } from "./ProjectFormModal";
import { OverlayActions } from "./OverlayActions";
import { DocPreviewDialog, type DocRequest } from "./DocPreviewDialog";
import { reloadWorkbench } from "./store";
import { openProjectTab } from "./wbTabs";
import { WbScreen } from "./WbScreen";
import { WB_TAB_ITEMS, type WbTab } from "./wbTabs";
import type { WbScreenProps } from "./screens/cards";
import type { Project } from "./types";

export function WorkbenchTab() {
  const projects = useSyncExternalStore(subscribeWorkbench, workbenchSnapshot);
  const loadError = useSyncExternalStore(subscribeWorkbench, workbenchLoadError);
  const { list: workspaces } = useWorkspaces();
  const [tab, setTab] = useState<WbTab>("overview");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; projectIds: string[] } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formProject, setFormProject] = useState<Project | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [docRequest, setDocRequest] = useState<DocRequest | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useTaskAutoStatus();

  useEffect(() => {
    if (toastMessage === null) return;
    const timer = setTimeout(() => setToastMessage(null), 2600);
    return () => clearTimeout(timer);
  }, [toastMessage]);
  const toast = useCallback((message: string) => setToastMessage(message), []);
  useEffect(() => {
    void ensureWorkbenchLoaded();
  }, []);

  /* 一键关联:候选工作区各建一个项目(口径见 linkableWorkspaces)。 */
  const linkWorkspaces = useCallback(() => {
    const pending = linkableWorkspaces(workspaces, projects);
    if (pending.length === 0) {
      toast(t("工作区项目都已关联"));
      return;
    }
    void Promise.all(pending.map((w) => createProject({ name: w.name, cwd: w.root })))
      .then((created) => toast(t("已关联:{count} 个项目", { count: String(created.length) })))
      .catch(() => undefined); /* 写盘失败已进 store.error 横幅 */
  }, [projects, workspaces, toast]);

  const today = todayISO();
  const filtered = useMemo(() => sortByRisk(projects, today).map((item) => item.project), [projects, today]);
  const screenProps: WbScreenProps = {
    projects: filtered,
    allProjects: projects,
    today,
    onOpen: (id) => {
      const project = projects.find((item) => item.id === id);
      if (project) openProjectTab(project.id, project.name);
    },
    onNewProject: () => { setFormProject(null); setFormOpen(true); },
    onLinkWorkspaces: linkWorkspaces,
    onToast: toast,
  };
  const openForm = (project: Project | null) => {
    setFormProject(project);
    setFormOpen(true);
  };
  const submitForm = async (values: ProjectFormValues) => {
    if (formProject) await updateProject(formProject.id, values);
    else await createProject(values);
    toast(t("已保存"));
  };
  const clearNow = () => {
    void clearAllProjects().then(
      () => toast(t("已清空")),
      (e) => toast(e instanceof Error ? e.message : String(e)),
    );
    setConfirmClear(false);
  };
  const refreshNow = () => {
    setRefreshing(true);
    void reloadWorkbench().then(() => { setRefreshing(false); toast(t("已从磁盘同步")); });
  };

  return (
    <div className="wb-console-tab">
      <header className="wb-top">
        <h2 className="wb-brand">{t("工作台")}</h2>
        <form
          className="wb-ask"
          onSubmit={(e) => {
            e.preventDefault();
            setAnswer(answerQuestion(question, projects, today));
          }}
        >
          <input
            value={question}
            placeholder={t("问一句,如:{example}", { example: QUESTION_EXAMPLES[0] })}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="wb-btn wb-btn-primary">{t("问一句")}</button>
        </form>
        <OverlayActions
          today={today}
          onToast={toast}
          onNewProject={() => openForm(null)}
          onLinkWorkspaces={linkWorkspaces}
          onRequestClear={() => setConfirmClear(true)}
          onDoc={setDocRequest}
          onRefresh={refreshNow}
          refreshing={refreshing}
        />
      </header>
      {answer ? (
        <div className="wb-answer">
          <pre>{answer.text}</pre>
          <div className="wb-answer-chips">
            {answer.projectIds.map((id) => {
              const project = projects.find((item) => item.id === id);
              return project ? (
                <button key={id} type="button" className="wb-chip" onClick={() => openProjectTab(project.id, project.name)}>{project.name}</button>
              ) : null;
            })}
            <button type="button" className="wb-chip wb-chip-quiet" onClick={() => setAnswer(null)}>{t("收起")}</button>
          </div>
        </div>
      ) : null}
      {loadError ? <div className="wb-load-error">{t("数据加载失败")}:{loadError}</div> : null}
      <div className="wb-body">
        <main className="wb-main">
          <div className="wb-tabs" role="tablist" aria-label={t("视图页签")}>
            {WB_TAB_ITEMS.map((item) => (
              <button
                key={item.key} type="button" role="tab"
                aria-selected={tab === item.key}
                className={`wb-tab${tab === item.key ? " is-active" : ""}`}
                onClick={() => setTab(item.key)}
              >{t(item.label)}</button>
            ))}
          </div>
          <WbScreen tab={tab} screenProps={screenProps} />
        </main>
      </div>
      {formOpen ? (
        <ProjectFormModal
          key={formProject?.id ?? "new"}
          project={formProject}
          onClose={() => setFormOpen(false)}
          onSubmit={(values) => submitForm(values).finally(() => setFormOpen(false))}
        />
      ) : null}
      {docRequest ? (
        <DocPreviewDialog
          request={docRequest}
          projects={projects}
          today={today}
          onClose={() => setDocRequest(null)}
          onToast={toast}
        />
      ) : null}
      <WbConfirm
        open={confirmClear}
        title={t("清空全部项目?")}
        body={t("将删除全部项目(含资料与任务),不可恢复。")}
        confirmLabel={t("清空")}
        onConfirm={clearNow}
        onCancel={() => setConfirmClear(false)}
      />
      {toastMessage ? <div className="wb-toast" role="status">{toastMessage}</div> : null}
    </div>
  );
}