/**
 * Sidebar settings cluster —— 左下角「设置齿轮 + pinned 快捷 + 版本号」。
 *
 * 布局（对齐参考截图）：
 *   ┌─ 上弹菜单 ──────────────┐
 *   │ (注册表动作…)        □ │  ← 右侧复选框 = pin 到底栏
 *   │ 设置                    │
 *   └────────────────────────┘
 *   [logo] [pinned…]      v0.1.0  ← 底栏
 *
 * 动作数据源 = kernel/sidebarActions 注册表(插件 activate 时自注册),
 * 本组件只渲染注册表与钉住状态,不认识任何具体动作 —— 与右栏面板同纪律。
 * 「设置」行是壳自有入口(openSettingsPanel),钉住/pin 上限 4 同 codemoss。
 * 版本号取 Tauri app version,浏览器 dev 环境回退 "0.1.0"。
 */

import { useEffect, useRef, useState } from "react";
import { appVersion } from "@kernel/ipc";
import { useSidebarActions, type SidebarAction } from "@kernel/sidebarActions";
import { openSettingsPanel, useSettingsState } from "@kernel/settings";
import logoUrl from "../assets/logo.png";
import { Settings } from "lucide-react";

/** 底栏空间有限,最多外显 4 个快捷入口(同 codemoss SIDEBAR_SETTINGS_PINNED_MAX)。 */
const PINNED_MAX = 4;
const PINNED_STORAGE_KEY = "shell.settingsPinned.v1";
/** 默认 pinned 的动作 id ─ 对齐参考截图(Git Graph + 网络代理 已钉在齿轮旁)。
 *  id 由各插件注册时声明;插件拔出 = 动作消失,钉住项自动隐藏,插回恢复。 */
const DEFAULT_PINNED: string[] = ["git-graph", "system-proxy"];

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED];
    const ids = parsed.filter((v): v is string => typeof v === "string");
    return ids.length > 0 ? ids.slice(0, PINNED_MAX) : [...DEFAULT_PINNED];
  } catch {
    return [...DEFAULT_PINNED];
  }
}

/** pin 复选框 ─ 圆角方块,选中显示对号;禁用(pin 满)时置灰。 */
function PinCheckbox({
  pinned,
  disabled,
  onToggle,
}: {
  pinned: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={pinned}
      className={`pin-checkbox${pinned ? " is-checked" : ""}${disabled ? " is-disabled" : ""}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={pinned ? "取消钉住" : "钉到底栏"}
    >
      {pinned ? <span className="pin-check">✓</span> : null}
    </button>
  );
}

export function SidebarSettingsCluster() {
  const [open, setOpen] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinned);
  const [version, setVersion] = useState("0.1.0");
  /* 订阅设置仅作重渲染触发:动作的 active 是渲染期求值的 getter,
     设置变更(如代理开关)时本簇重渲、getter 重新取值;壳不读任何具体字段。 */
  useSettingsState();
  const actions = useSidebarActions();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0")); // 纯浏览器 dev(vite)下无 Tauri runtime
  }, []);

  /* 点击外部 / Esc 关菜单。 */
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const persistPinned = (next: string[]) => {
    setPinnedIds(next);
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
  };

  const togglePinned = (id: string) => {
    if (pinnedIds.includes(id)) {
      persistPinned(pinnedIds.filter((p) => p !== id));
    } else if (pinnedIds.length < PINNED_MAX) {
      persistPinned([...pinnedIds, id]);
    }
  };

  /* 浮层类动作的锚点 = 本簇右缘(浮层开在右侧,自身做视口夹取)。 */
  const anchor = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: (rect?.right ?? 0) + 8, y: rect?.top ?? 0 };
  };

  const pinnedActions = pinnedIds
    .map((id) => actions.find((a) => a.id === id))
    .filter((a): a is SidebarAction => Boolean(a));
  const atPinLimit = pinnedIds.length >= PINNED_MAX;

  const select = (action: SidebarAction) => {
    setOpen(false);
    action.onSelect(anchor());
  };

  return (
    <div className="settings-cluster" ref={rootRef}>
      {open && (
        <div className="settings-menu" role="menu" aria-label="设置菜单">
          {actions.map((action) => {
            const pinned = pinnedIds.includes(action.id);
            const isActive = action.active?.() ?? false;
            return (
              <div
                key={action.id}
                className={`settings-menu-row${isActive ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="settings-menu-item"
                  onClick={() => select(action)}
                >
                  <span className="settings-menu-icon" aria-hidden>
                    <action.icon size={14} />
                  </span>
                  <span className="settings-menu-label">{action.label}</span>
                </button>
                <PinCheckbox
                  pinned={pinned}
                  disabled={!pinned && atPinLimit}
                  onToggle={() => togglePinned(action.id)}
                />
              </div>
            );
          })}
          <div className="settings-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="settings-menu-item settings-menu-settings"
            onClick={() => {
              setOpen(false);
              openSettingsPanel();
            }}
          >
            <span className="settings-menu-icon" aria-hidden>
              <Settings size={14} />
            </span>
            <span className="settings-menu-label">设置</span>
          </button>
        </div>
      )}

      <div className="settings-cluster-bar">
        <button
          type="button"
          className={`settings-bar-btn settings-gear${open ? " is-active" : ""}`}
          aria-label="设置"
          aria-expanded={open}
          aria-haspopup="menu"
          title="设置"
          onClick={() => setOpen((v) => !v)}
        >
          <img src={logoUrl} alt="" className="settings-logo" />
        </button>
        {pinnedActions.map((action) => {
          const isActive = action.active?.() ?? false;
          return (
            <button
              key={action.id}
              type="button"
              className={`settings-bar-btn${isActive ? " is-active" : ""}`}
              aria-label={action.label}
              aria-pressed={isActive}
              title={action.label}
              onClick={() => action.onSelect(anchor())}
            >
              <action.icon size={14} />
            </button>
          );
        })}
        <span className="settings-cluster-spacer" />
        <span className="settings-cluster-version">v{version}</span>
      </div>
    </div>
  );
}
