/**
 * 右栏底部文件操作条 —— 新建文件/文件夹 + 刷新 + 面板专属动作。
 *
 * 自 WorkspaceSubbar 演变(2026-09-14 UI 微调):工作区选择器上移顶栏
 * (WorkspaceSwitcher),本条沉到右栏底部;新建/刷新按钮转发激活面板注册槽,
 * 外壳不认识业务面板。
 */

import { useRef, useState } from "react";
import { ArrowClockwise, FilePlus, FolderSimplePlus } from "@phosphor-icons/react";
import { useFilePanel } from "@kernel/filePanel";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";

export function FileActionsBar() {
  /* 刷新/新建文件/新建文件夹:调激活面板注册的对应槽;刷新 in-flight 转圈。 */
  const { mode, panels } = useFilePanel();
  const { list } = useWorkspaces();
  const activePanel = panels.find((p) => p.id === mode);
  const activeRefresh = activePanel?.refresh;
  const [refreshBusy, setRefreshBusy] = useState(false);
  const refreshBatchRef = useRef(0);
  /* 无工作区时整条隐藏(沿用旧 subbar 语义;新建/刷新槽无树可作用)。 */
  if (list.length === 0) return null;

  const handleRefreshFiles = () => {
    if (!activeRefresh || refreshBusy) return;
    const myBatch = ++refreshBatchRef.current;
    setRefreshBusy(true);
    /* refresh 实现经 .then 调用:同步抛错也归入 rejection,finally 必然清转圈 */
    void Promise.resolve()
      .then(activeRefresh)
      .finally(() => {
        if (refreshBatchRef.current === myBatch) setRefreshBusy(false);
      });
  };

  return (
    <div className="panel-subbar">
      <span className="panel-subbar-actions">
        <button
          type="button"
          className="panel-subbar-action"
          aria-label={t("新建文件")}
          title={t("新建文件")}
          disabled={!activePanel?.newFile}
          onClick={() => activePanel?.newFile?.()}
        >
          <FilePlus size="0.75rem" aria-hidden />
        </button>
        <button
          type="button"
          className="panel-subbar-action"
          aria-label={t("新建文件夹")}
          title={t("新建文件夹")}
          disabled={!activePanel?.newFolder}
          onClick={() => activePanel?.newFolder?.()}
        >
          <FolderSimplePlus size="0.75rem" aria-hidden />
        </button>
        <button
          type="button"
          className="panel-subbar-action"
          aria-label={t("刷新文件树")}
          title={t("刷新文件树")}
          onClick={handleRefreshFiles}
        >
          <ArrowClockwise
            size="0.75rem"
            aria-hidden
            className={refreshBusy ? "animate-spin" : undefined}
          />
        </button>
        {activePanel?.actions ? <activePanel.actions /> : null}
      </span>
    </div>
  );
}
