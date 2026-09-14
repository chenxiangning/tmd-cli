/**
 * 右栏 subbar 第 2 行 —— 工作区切换下拉 + 文件操作按钮。
 *
 * 自 RightPanelToolbar.tsx 拆出(文件规模铁则)。工作区 label 点击弹下拉菜单
 * (portal 挂 document.body + fixed 定位,复刻 wsmenu 模式,复用 panel-overflow
 * 样式),行点击 = setActiveWorkspace 切换;新建/刷新按钮转发激活面板注册槽,
 * 外壳不认识业务面板。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwise,
  CaretDown,
  Check,
  FilePlus,
  FolderSimplePlus,
} from "@phosphor-icons/react";
import { useFilePanel } from "@kernel/filePanel";
import {
  setActiveWorkspace,
  useWorkspaces,
  workspaceDisplayName,
  type Workspace,
} from "@kernel/workspace";
import { t } from "@kernel/i18n";

/** 工作区切换下拉:fixed 菜单列出全部工作区,行点击切换激活。 */
function WorkspaceSwitchMenu({
  workspaces,
  activeId,
  position,
  onClose,
}: {
  workspaces: Workspace[];
  activeId: string | null;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="panel-overflow-backdrop" role="presentation" onClick={onClose} />
      <div
        className="panel-overflow-menu panel-ws-menu"
        style={{ left: position.x, top: position.y }}
        role="menu"
      >
        {workspaces.map((ws) => {
          const isActive = ws.id === activeId;
          return (
            <button
              key={ws.id}
              type="button"
              role="menuitem"
              className={`panel-overflow-item panel-ws-item${isActive ? " is-active" : ""}`}
              title={ws.root}
              onClick={() => {
                setActiveWorkspace(ws.id);
                onClose();
              }}
            >
              <span className="panel-overflow-item-label">{workspaceDisplayName(ws)}</span>
              {isActive ? <Check aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

export function WorkspaceSubbar() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const root = active?.root;
  /* 不用 useMemo:alias 原地变更(list 项引用不变)会滞 stale;取名字符串操作本就廉价。 */
  const label = active ? workspaceDisplayName(active).toUpperCase() : "";
  /* 刷新/新建文件/新建文件夹:调激活面板注册的对应槽;刷新 in-flight 转圈。 */
  const { mode, panels } = useFilePanel();
  const activePanel = panels.find((p) => p.id === mode);
  const activeRefresh = activePanel?.refresh;
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null);
  const refreshBatchRef = useRef(0);

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

  if (!root) return null;

  return (
    <div className="panel-subbar">
      <button
        type="button"
        className="panel-subbar-label panel-subbar-switch"
        aria-label={t("切换工作区")}
        aria-haspopup="menu"
        aria-expanded={wsMenu !== null}
        title={root}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setWsMenu({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <span className="panel-subbar-switch-text">{label}</span>
        <CaretDown aria-hidden />
      </button>
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
      {wsMenu ? (
        <WorkspaceSwitchMenu
          workspaces={list}
          activeId={active?.id ?? null}
          position={wsMenu}
          onClose={() => setWsMenu(null)}
        />
      ) : null}
    </div>
  );
}
