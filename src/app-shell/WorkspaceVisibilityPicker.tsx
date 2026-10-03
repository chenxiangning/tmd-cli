/**
 * 左下角「工作区显隐」多选菜单(2026-10-04)—— 控制左侧栏显示哪些工作区。
 *
 * 触发钮(ListChecks + 当前工作区名)在底栏缩放组原位;上弹多选清单
 * (portal 挂 body + fixed 定位,复用 panel-overflow 样式)。
 * 语义:
 * - 写 settings.workspaceHiddenIds(隐藏清单,空 = 全部显示);
 *   左栏过滤纯函数 = workspace 插件 utils.visibleWorkspaces,两处锁步。
 * - 勾选(恢复显示)时顺带 setActiveWorkspace 切一次 —— 右侧文件树跟着
 *   切到「最后勾选的工作区」;只切一下,不做强绑定(树此后继续跟随自己的
 *   活动工作区,与显隐清单互不联动)。
 * - 「至少留一个」按全局现存表计数(本菜单即全局口径;左栏另有来源视图
 *   过滤,极端组合下 local 视图可能临时为空,切视图即恢复,属视图层口径)。
 * - 菜单不随勾选关闭(多选连续操作);点外/Esc 关;窗口 resize 直接收菜单
 *   (fixed 一次性坐标不重算,与本仓 portal 菜单家族一致);开合态受控于簇
 *   (SidebarSettingsCluster 持有,与齿轮菜单簇级互斥,防同角落两层菜单叠压)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListChecks } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { WorkspaceMenuIcon } from "./WorkspaceSwitcher";
import {
  setActiveWorkspace,
  useWorkspaces,
  workspaceDisplayName,
  type Workspace,
} from "@kernel/workspace";

/** 菜单行:整行 = 复选开关(勾 = 显示),最后可见一个不可再取消。 */
function VisibilityRow({
  ws,
  visible,
  disableHide,
  onToggle,
}: {
  ws: Workspace;
  visible: boolean;
  disableHide: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`panel-overflow-item${visible ? "" : " is-dim"}`}>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={visible}
        className="panel-overflow-item-btn"
        disabled={visible && disableHide}
        title={visible && disableHide ? t("至少保留一个可见工作区") : ws.root}
        onClick={onToggle}
      >
        <span className={`panel-overflow-item-check${visible ? " is-checked" : ""}`} aria-hidden>
          {visible ? <Check /> : null}
        </span>
        <span className="panel-overflow-item-icon" aria-hidden>
          <WorkspaceMenuIcon ws={ws} />
        </span>
        <span className="panel-overflow-item-label">{workspaceDisplayName(ws)}</span>
      </button>
    </div>
  );
}

export function WorkspaceVisibilityPicker({
  open,
  onOpenChange,
}: {
  /** 受控开合:开合态归簇(SidebarSettingsCluster)持有 —— 与齿轮菜单簇级互斥,
   *  同角落两层菜单不可能同开(2026-10-04 交互审查 P1-2)。 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { list, activeId } = useWorkspaces();
  const { settings } = useSettingsState();
  const hidden = settings.workspaceHiddenIds;
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const rootRef = useRef<HTMLDivElement>(null);

  const visibleList = list.filter((ws) => !hiddenSet.has(ws.id));
  /* 已删工作区的残留 id 不计可见数(计数只认现存表,防误锁最后一行)。 */
  const visibleCount = visibleList.length;
  const active = list.find((w) => w.id === activeId) ?? list[0];

  /* 勾选 = 恢复显示 + 切一次活动工作区(右侧文件树跟着切);取消 = 入隐藏清单。 */
  const toggle = (ws: Workspace) => {
    if (hiddenSet.has(ws.id)) {
      updateSettings({ workspaceHiddenIds: hidden.filter((id) => id !== ws.id) });
      setActiveWorkspace(ws.id);
      return;
    }
    if (visibleCount <= 1) return; /* 最后一个可见:保留(行已禁用,兜底)。 */
    updateSettings({ workspaceHiddenIds: [...hidden, ws.id] });
  };

  /* onOpenChange 走 ref(effect event 语义):监听器只随 open 挂卸,不因父级
   * 回调换身份反复退订重订(react-doctor prefer-use-effect-event)。 */
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);
  /* 点击外部 / Esc 关菜单(齿轮菜单同款;菜单走 portal,rootRef 只罩触发钮);
   * resize 直接收菜单:fixed 一次性坐标不重算,防与触发钮错位。 */
  useEffect(() => {
    if (!open) return;
    const close = () => onOpenChangeRef.current(false);
    const onMouseDown = (e: MouseEvent) => {
      /* portal 菜单不在 rootRef 子树内,例外放行(menu 自身onClick 不冒泡关闭)。 */
      const el = e.target as HTMLElement;
      if (rootRef.current?.contains(el) || el.closest(".ws-vis-menu")) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  /* 菜单锚:底栏触发钮上方 6px、左对齐;宽 240 右缘夹取,高自内容(上限滚动)。 */
  const menuPos = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 248 - 8)),
      y: Math.max(8, (rect?.top ?? 0) - 6),
    };
  };
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="ws-vis-picker" ref={rootRef}>
      <button
        type="button"
        className="settings-bar-btn ws-vis-trigger"
        aria-label={t("工作区显隐")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-hint={t("工作区显隐")}
        title=""
        onClick={() => {
          setPos(open ? null : menuPos());
          onOpenChange(!open);
        }}
      >
        <ListChecks size="1rem" aria-hidden />
        {active && <span className="ws-vis-trigger-name">{workspaceDisplayName(active)}</span>}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="panel-overflow-menu ws-vis-menu"
            style={{ left: pos.x, top: pos.y, transform: "translateY(-100%)" }}
            role="menu"
            aria-label={t("显示的工作区")}
          >
            <div className="ws-vis-caption">{t("显示的工作区")}</div>
            <div className="ws-vis-rows">
              {list.map((ws) => (
                <VisibilityRow
                  key={ws.id}
                  ws={ws}
                  visible={!hiddenSet.has(ws.id)}
                  disableHide={visibleCount <= 1}
                  onToggle={() => toggle(ws)}
                />
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
