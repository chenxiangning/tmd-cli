/**
 * 工作台本页中央 tab(kind "wb.console",activate 期注册)。
 * 结构:顶栏(标题 + 问一句 + OverlayActions)→ 页签 + 六视图(2026-10-11 日历并入工作日志月视图);
 * 详情弹层/表单/清空确认走 DialogShell 骨架。弹层自收,本组件不处理 Esc。
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowClockwise, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useWorkspaces } from "@kernel/workspace";
import { sortByRisk, todayISO } from "./analysis";
import { useTaskAutoStatus } from "./useTaskAutoStatus";
import { QUESTION_EXAMPLES, answerQuestion } from "./query";
import { clearAllProjects, clearSampleProjects, createProject, ensureWorkbenchLoaded, reloadWorkbench, restoreProject, subscribeWorkbench, updateProject, workbenchLoadError, workbenchSnapshot } from "./store";
import { activeProjects, linkableWorkspaces } from "./views";
import { runIpc } from "./ipcToast";
import { LinkWorkspacesDialog } from "./LinkWorkspacesDialog";
import { WbConfirm } from "./ui";
import { ProjectFormModal, type ProjectFormValues } from "./ProjectFormModal";
import { OverlayActions } from "./OverlayActions";
import { DocGenDialog } from "./docgen/DocGenDialog";
import { openProjectTab } from "./wbTabs";
import { WbScreen } from "./WbScreen";
import { WB_TAB_ITEMS, type WbTab } from "./wbTabs";
import type { WbScreenProps } from "./screens/cards";
import type { EditorTab } from "@kernel/tabs";
import type { Project } from "./types";

export function WorkbenchTab({ tab: editorTab }: { tab: EditorTab }) {
  const payload = editorTab.payload as { tab?: string; projectFilter?: string } | null;
  const projects = useSyncExternalStore(subscribeWorkbench, workbenchSnapshot);
  const loadError = useSyncExternalStore(subscribeWorkbench, workbenchLoadError);
  const { list: workspaces } = useWorkspaces();
  const [tab, setTab] = useState<WbTab>(payload?.tab === "docs" ? "docs" : "overview");
  const [docsFilter, setDocsFilter] = useState<string | null>(payload?.projectFilter ?? null);
  const [boardFormOpen, setBoardFormOpen] = useState(false);
  const [docGen, setDocGen] = useState<{ locked: Project | null } | null>(null);
  const [lastPayload, setLastPayload] = useState(payload);
  /* 深链:openWorkbenchDocsTab 换 payload 重开本 tab → 页签与过滤跟移(渲染期调整)。 */
  if (lastPayload !== payload) {
    setLastPayload(payload);
    if (payload?.tab === "docs") {
      setTab("docs");
      setDocsFilter(payload.projectFilter ?? null);
    }
  }
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; projectIds: string[] } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formProject, setFormProject] = useState<Project | null>(null);
  const [confirmClear, setConfirmClear] = useState<null | "all" | "samples">(null);
  /* ✕ 关闭的是「这条」错误:换一条新错误(字符串不同)横幅重现,同文不重复打扰。 */
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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

  /* 一键关联:候选清单勾选弹层(A1),确认后逐个建项目;部分失败计数进 toast。
   * 候选只算一处:门禁与弹层同源,防全量列表(default 兜底)漏进弹层。 */
  const [linkOpen, setLinkOpen] = useState(false);
  const linkCandidates = useMemo(() => linkableWorkspaces(workspaces, projects), [workspaces, projects]);
  const linkWorkspaces = useCallback(() => {
    if (linkCandidates.length === 0) {
      toast(t("工作区项目都已关联"));
      return;
    }
    setLinkOpen(true);
  }, [linkCandidates, toast]);
  const actions = useWbActions({ toast, formProject, setConfirmClear });

  const today = todayISO();
  /* 归档项目在此单点退出全部视图(概览/聚焦/看板/文档中心统计与列表)。 */
  const visible = useMemo(() => activeProjects(projects), [projects]);
  const archived = useMemo(() => projects.filter((p) => p.archived), [projects]);
  const filtered = useMemo(() => sortByRisk(visible, today).map((item) => item.project), [visible, today]);
  /* 页签显式切换即复位一次性表单信号(防回看板时表单重弹)。 */
  const switchTab = useCallback((next: WbTab) => { setTab(next); setBoardFormOpen(false); }, []);
  const screenProps: WbScreenProps = {
    projects: filtered,
    allProjects: visible,
    today,
    docsFilter,
    boardFormOpen,
    archivedProjects: archived,
    onRestoreProject: (id) => {
      void runIpc(restoreProject(id), toast, t("已恢复:「{name}」", { name: projects.find((p) => p.id === id)?.name ?? id }));
    },
    onOpen: (id) => {
      const project = projects.find((item) => item.id === id);
      if (project) openProjectTab(project.id, project.name);
    },
    onNewProject: () => { setFormProject(null); setFormOpen(true); },
    onLinkWorkspaces: linkWorkspaces,
    onToast: toast,
    onDocGen: (projectId) => setDocGen({ locked: projects.find((p) => p.id === projectId) ?? null }),
    onTab: switchTab,
    /* 聚焦页清净态「新建任务」:切看板并直接展开表单(一次性布尔,看板挂载即消费)。 */
    onNewTask: () => { setTab("board"); setBoardFormOpen(true); },
  };
  const openForm = (project: Project | null) => {
    setFormProject(project);
    setFormOpen(true);
  };

  return (
    <div className="wb-console-tab" data-icon-decor="workbench-view">
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
          onRequestClear={() => setConfirmClear("all")}
          onRequestClearSamples={() => setConfirmClear("samples")}
          onDocGen={() => setDocGen({ locked: null })}
          onRefresh={actions.refreshNow}
          refreshing={actions.refreshing}
        />
      </header>
      {answer ? <AskAnswer answer={answer} projects={projects} onPick={openProjectTab} onClose={() => setAnswer(null)} /> : null}
      {loadError && dismissedError !== loadError ? (
        <div className="wb-load-error">
          <span className="wb-load-error-text">{t("数据加载失败")}:{loadError}</span>
          <button
            type="button" className="wb-btn wb-btn-xs" disabled={actions.refreshing}
            onClick={() => { setDismissedError(null); actions.refreshNow(); }}
          ><ArrowClockwise size={11} />{t("重试")}</button>
          <button type="button" className="wb-btn wb-btn-xs" aria-label={t("关闭")} onClick={() => setDismissedError(loadError)}>
            <X size={11} />
          </button>
        </div>
      ) : null}
      <div className="wb-body">
        <main className="wb-main">
          <WbTabBar tab={tab} onTab={switchTab} />
          <WbScreen tab={tab} screenProps={screenProps} />
        </main>
      </div>
      {formOpen ? (
        <ProjectFormModal
          key={formProject?.id ?? "new"}
          project={formProject}
          onClose={() => setFormOpen(false)}
          /* 关窗由 modal 自身 onSuccess 驱动(onSubmit.then(onClose));
           * 失败留在窗内显示 wb-form-error,不丢稿。 */
          onSubmit={actions.submitForm}
        />
      ) : null}
      {docGen ? (
        <DocGenDialog
          lockedProject={docGen.locked}
          projects={projects}
          today={today}
          onClose={() => setDocGen(null)}
          onToast={toast}
        />
      ) : null}
      <ClearConfirm mode={confirmClear} onMode={setConfirmClear} onConfirm={confirmClear === "samples" ? actions.clearSamplesNow : actions.clearNow} />
      {linkOpen ? (
        <LinkWorkspacesDialog
          workspaces={linkCandidates}
          onClose={() => setLinkOpen(false)}
          onToast={toast}
        />
      ) : null}
      {toastMessage ? <div className="wb-toast" role="status">{toastMessage}</div> : null}
    </div>
  );
}

/** 问一句答案块(结论 + 命中项目 chip 跳转)。 */
function AskAnswer({ answer, projects, onPick, onClose }: {
  answer: { text: string; projectIds: string[] };
  projects: readonly Project[];
  onPick: (projectId: string, title: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="wb-answer">
      <pre>{answer.text}</pre>
      <div className="wb-answer-chips">
        {answer.projectIds.map((id) => {
          const project = projects.find((item) => item.id === id);
          return project ? (
            <button key={id} type="button" className="wb-chip" onClick={() => onPick(project.id, project.name)}>{project.name}</button>
          ) : null;
        })}
        <button type="button" className="wb-chip wb-chip-quiet" onClick={onClose}>{t("收起")}</button>
      </div>
    </div>
  );
}

/** 本页数据动作簇(关联外的写盘动作 + 同步态),自组件体拆出守复杂度铁律。 */
function useWbActions(ctx: {
  toast: (m: string) => void;
  formProject: Project | null;
  setConfirmClear: (v: null | "all" | "samples") => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const submitForm = async (values: ProjectFormValues) => {
    if (ctx.formProject) await updateProject(ctx.formProject.id, values);
    else await createProject(values);
    ctx.toast(t("已保存"));
  };
  const clearNow = () => {
    void clearAllProjects().then(
      () => ctx.toast(t("已清空")),
      (e) => ctx.toast(e instanceof Error ? e.message : String(e)),
    );
    ctx.setConfirmClear(null);
  };
  const clearSamplesNow = () => {
    void clearSampleProjects().then(
      (count) => ctx.toast(t("已清空:{count} 个示例项目", { count: String(count) })),
      (e) => ctx.toast(e instanceof Error ? e.message : String(e)),
    );
    ctx.setConfirmClear(null);
  };
  const refreshNow = () => {
    setRefreshing(true);
    /* finally 复位:失败走 store 错误横幅(可关闭/重试),同步钮不再永禁。
     * reloadWorkbench 永不 reject,按装载后错误态分流 toast,防「失败也报已同步」。 */
    void reloadWorkbench()
      .then(() => ctx.toast(workbenchLoadError() ?? t("已从磁盘同步")))
      .finally(() => setRefreshing(false));
  };
  return { submitForm, clearNow, clearSamplesNow, refreshNow, refreshing };
}

/** 视图页签行(纯展示;激活态经 aria-selected)。 */
function WbTabBar({ tab, onTab }: { tab: WbTab; onTab: (t: WbTab) => void }) {
  return (
    <div className="wb-tabs" role="tablist" aria-label={t("视图页签")}>
      {WB_TAB_ITEMS.map((item) => (
        <button
          key={item.key} type="button" role="tab"
          aria-selected={tab === item.key}
          className={`wb-tab${tab === item.key ? " is-active" : ""}`}
          onClick={() => onTab(item.key)}
        >{t(item.label)}</button>
      ))}
    </div>
  );
}

/** 清空确认弹层(文案随模式;确认动作由调用方注入)。 */
function ClearConfirm({ mode, onMode, onConfirm }: {
  mode: null | "all" | "samples";
  onMode: (m: null | "all" | "samples") => void;
  onConfirm: () => void;
}) {
  const samples = mode === "samples";
  return (
    <WbConfirm
      open={mode !== null}
      title={samples ? t("清理示例数据?") : t("清空全部项目?")}
      body={samples
        ? t("将删除带「示例」标签的项目(含资料与任务),不影响其他项目;之后可重新生成。")
        : t("将删除全部项目(含资料与任务),不可恢复。")}
      confirmLabel={samples ? t("清理") : t("清空")}
      onConfirm={onConfirm}
      onCancel={() => onMode(null)}
    />
  );
}
