/**
 * 顶栏工作区选择器 —— 自右栏 subbar 上移(UI 微调 2026-09-14)。
 *
 * label 点击弹工作区下拉(portal 挂 document.body + fixed 定位,复用 panel-overflow
 * 样式),行点击 = setActiveWorkspace 切换;下拉器/行右键 = 合并菜单(见
 * WorkspaceRowMenu.tsx);菜单内「新建文件/文件夹」经 files 面板句柄槽转发。
 * GitBranchLabel 不随本组件:由 TopBar 中区右缘挂(TitlebarBranchLabel 自取活动工作区)。
 *
 * 2026-10-04:菜单簇抽成 useWorkspaceSwitchMenus hook —— 顶栏文字钮与左缘
 * LeftRail 工作区入口图标钮共用同一套菜单组件与行为逻辑(下拉夹取/行右键/
 * 新建于树);两实例状态各自独立,同屏双菜单由全屏 backdrop 天然互斥。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, FolderSimple, GitBranch, GitFork } from "@phosphor-icons/react";
import { DecorIcon } from "@kernel/iconSet";
import { peekWorktreeMeta } from "@plugins/workspace/useWorktreeCluster";
import { stringHue } from "@kernel/colorHash";
import { setFilePanelMode, useFilePanel } from "@kernel/filePanel";
import { resolveBranchCwd, useGitViewRepo } from "@kernel/gitViewRepo";
import { ipc } from "@kernel/ipc";
import {
  setActiveWorkspace,
  useWorkspaces,
  workspaceDisplayName,
  type Workspace,
} from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { WorkspaceRowMenu } from "./WorkspaceRowMenu";

/** 工作区菜单行首图标:worktree 卡用 GitFork(侧栏卡同款 DecorIcon 装饰字形),
 *  普通工作区用文件夹。身份判定 = worktree 簇缓存同步窥探(peekWorktreeMeta,
 *  只读绝不 spawn;侧栏挂载即全量预探故菜单打开时必热,冷读回落文件夹),
 *  跨层消费声明见 workspace/useWorktreeCluster.peekWorktreeMeta 头注。 */
export function WorkspaceMenuIcon({ ws }: { ws: Workspace }) {
  const wt = peekWorktreeMeta(ws.root);
  return wt && !wt.isMain ? (
    <DecorIcon id="worktree" Fallback={GitFork} className="is-worktree-icon" aria-hidden />
  ) : (
    <FolderSimple aria-hidden />
  );
}

/** 当前分支 label:优先 git 面板解析出的选中仓(@kernel/gitViewRepo 跨层契约,
 *  多仓工作区根常非仓,须跟随面板正在查看的仓),回退工作区根(单仓=根仓);
 *  非仓/detached(空串)不渲染。5s 失焦暂停轮询(对齐 gitDecorate / useGitStatus 策略)。 */
function GitBranchLabel({ workspaceId, root }: { workspaceId: string; root: string }) {
  const cwd = resolveBranchCwd(useGitViewRepo(), workspaceId, root);
  const [info, setInfo] = useState<{ branch: string; upstream: string | null }>({
    branch: "",
    upstream: null,
  });
  useEffect(() => {
    let alive = true;
    /* 换根即清:多仓工作区根常非仓( discover 向上找不到 .git 即拒),
     * 无拒绝分支时旧工作区分支会永远滞留(2026-09-15 实证 bug)。 */
    setInfo((prev) => (prev.branch === "" ? prev : { branch: "", upstream: null }));
    const scan = () => {
      ipc.gitStatus(cwd).then(
        (s) => {
          if (!alive) return;
          /* 值等不换对象:5s 轮询不空转重渲染(对齐 panelStore 的值等 emit 纪律)。 */
          setInfo((prev) =>
            prev.branch === s.branch && prev.upstream === s.upstream
              ? prev
              : { branch: s.branch, upstream: s.upstream },
          );
        },
        () => {
          if (alive) setInfo((prev) => (prev.branch === "" ? prev : { branch: "", upstream: null }));
        },
      );
    };
    scan();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") scan();
    }, 5_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [cwd]);
  if (!info.branch) return null;
  return (
    <span
      className="titlebar-branch-label"
      style={{ "--tag-h": stringHue(info.branch) } as React.CSSProperties}
      title={info.upstream ? `${info.branch} → ${info.upstream}` : info.branch}
    >
      <GitBranch aria-hidden />
      <span className="titlebar-branch-label-text">{info.branch}</span>
      {info.upstream && <span className="titlebar-branch-label-up">→ {info.upstream}</span>}
    </span>
  );
}

/** 顶栏分支 label 挂点:TopBar 中区右缘渲染(2026-09-14 用户口径),自取活动工作区。 */
export function TitlebarBranchLabel() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  if (!active) return null;
  return <GitBranchLabel workspaceId={active.id} root={active.root} />;
}

/** 工作区切换下拉:fixed 菜单列出全部工作区,行点击切换激活。 */
function WorkspaceSwitchMenu({
  workspaces,
  activeId,
  position,
  onClose,
  onRowMenu,
}: {
  workspaces: Workspace[];
  activeId: string | null;
  position: { x: number; y: number };
  onClose: () => void;
  onRowMenu: (ws: Workspace, x: number, y: number) => void;
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
              onContextMenu={(e) => {
                e.preventDefault();
                onRowMenu(ws, e.clientX, e.clientY);
              }}
            >
              <span className="panel-overflow-item-icon" aria-hidden>
                <WorkspaceMenuIcon ws={ws} />
              </span>
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

/** 工作区切换菜单簇 hook(2026-10-04 抽出):下拉 + 行右键菜单 + 新建于树的
 *  槽转发。消费方两处:顶栏 WorkspaceSwitcher 文字钮、左缘 LeftRail 工作区入口
 *  图标钮 —— 两实例共用菜单组件与行为逻辑(此源),状态各自独立,同屏双菜单
 *  由全屏 backdrop 互斥。openMenu(x, y):以传入锚点开下拉(x/y 已含各自入口的
 *  方向语义,菜单宽 240 右缘夹取对齐 PanelRail 的 toggleOverflow);
 *  menus:portal 层,随 hook 渲染。 */
export function useWorkspaceSwitchMenus() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const { mode, panels } = useFilePanel();
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ ws: Workspace; x: number; y: number } | null>(null);

  const openMenu = (x: number, y: number) => {
    /* 菜单 min-width 240:窄窗右缘夹取,防右侧(active Check 区)被裁。 */
    setWsMenu({ x: Math.max(12, Math.min(x, window.innerWidth - 240 - 12)), y });
  };

  /** 行右键菜单直开(入口钮右键 = 当前活动工作区的行菜单)。 */
  const openRowMenu = (ws: Workspace, x: number, y: number) => setRowMenu({ ws, x, y });

  /* 新建文件/文件夹:确保 files 面板 + 目标工作区激活,再经树句柄槽弹命名框。
   * ponytail: 切换后固定等 400ms 让文件树重挂上交句柄;未就绪则静默,再点一次即可。 */
  const handleNewInTree = (wsId: string, kind: "file" | "folder") => {
    const filesPanel = panels.find((p) => p.id === "files");
    const slot = kind === "file" ? filesPanel?.newFile : filesPanel?.newFolder;
    if (wsId === (active?.id ?? null) && mode === "files") {
      slot?.();
      return;
    }
    setFilePanelMode("files");
    if (wsId !== (active?.id ?? null)) setActiveWorkspace(wsId);
    window.setTimeout(() => slot?.(), 400);
  };

  const menus = (
    <>
      {wsMenu ? (
        <WorkspaceSwitchMenu
          workspaces={list}
          activeId={active?.id ?? null}
          position={wsMenu}
          onClose={() => setWsMenu(null)}
          onRowMenu={(ws, x, y) => {
            setWsMenu(null);
            setRowMenu({ ws, x, y });
          }}
        />
      ) : null}
      {rowMenu ? (
        <WorkspaceRowMenu
          ws={rowMenu.ws}
          position={rowMenu}
          onClose={() => setRowMenu(null)}
          onNewInTree={(kind) => handleNewInTree(rowMenu.ws.id, kind)}
        />
      ) : null}
    </>
  );
  return { list, active, openMenu, openRowMenu, menuOpen: wsMenu !== null, menus };
}

export function WorkspaceSwitcher() {
  /* 菜单簇(下拉 + 行右键菜单)与左 rail 工作区入口共用,见 hook 头注。 */
  const { active, openMenu, openRowMenu, menuOpen, menus } = useWorkspaceSwitchMenus();
  /* 不用 useMemo:alias 原地变更(list 项引用不变)会滞 stale;取名字符串操作本就廉价。 */
  const label = active ? workspaceDisplayName(active).toUpperCase() : "";

  if (!active) return menus;

  return (
    <>
      <button
        type="button"
        className="titlebar-ws-switch"
        aria-label={t("切换工作区")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={active.root}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          openMenu(rect.left, rect.bottom + 4);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openRowMenu(active, e.clientX, e.clientY);
        }}
      >
        <span className="titlebar-ws-switch-text">{label}</span>
        <CaretDown aria-hidden />

      </button>
      {menus}
    </>
  );
}
