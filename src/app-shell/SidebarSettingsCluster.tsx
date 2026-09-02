/**
 * Sidebar settings cluster —— 复刻 codemoss 左下角「设置齿轮 + pinned 快捷 + 版本号」。
 *
 * 布局（对齐参考截图）：
 *   ┌─ 上弹菜单 ──────────────┐
 *   │ 锁屏 / Git Graph / …  □ │  ← 右侧复选框 = pin 到底栏
 *   │ 设置                    │
 *   └────────────────────────┘
 *   [logo] [pinned…]      v0.1.0  ← 底栏
 *
 * 当前实装状态：
 * - pin/unpin 是真功能（localStorage 持久化，上限 4，同 codemoss）；
 * - 网络代理已实装：经内核事件总线唤起 network-proxy 插件的浮层
 *   (滑动块开关 + 代理地址),active 态读 settings.networkProxyEnabled;
 * - 其余菜单动作（锁屏 / Git Graph / 运行时提示）仍为占位（console.info）;
 * - 版本号取 Tauri app version，浏览器 dev 环境回退 "0.1.0"。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { appVersion } from "@kernel/ipc";
import { host } from "@kernel/host";
import logoUrl from "../assets/logo.png";
import { openSettingsPanel, useSettingsState } from "../kernel/settings";
import {
  Check,
  CircleAlert,
  GitCommitHorizontal,
  Lock,
  Network,
  Settings,
} from "lucide-react";

/** 底栏空间有限,最多外显 4 个快捷入口(同 codemoss SIDEBAR_SETTINGS_PINNED_MAX)。 */
const PINNED_MAX = 4;
const PINNED_STORAGE_KEY = "shell.settingsPinned.v1";
/** 默认 pinned ─ 对齐参考截图(Git Graph + 网络代理 已钉在齿轮旁)。 */
const DEFAULT_PINNED: SettingsActionId[] = ["git-graph", "system-proxy"];

type SettingsActionId =
  | "lock"
  | "git-graph"
  | "system-proxy"
  | "runtime-notice";

interface SettingsAction {
  id: SettingsActionId;
  label: string;
  icon: ReactNode;
  /** 占位动作:目前只打日志 + 关菜单。 */
  onSelect: () => void;
  /** toggle 类动作的激活态(控制菜单对号/底栏高亮)。 */
  active?: boolean;
}

function loadPinned(): SettingsActionId[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return DEFAULT_PINNED;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_PINNED;
    return parsed.slice(0, PINNED_MAX) as SettingsActionId[];
  } catch {
    return DEFAULT_PINNED;
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
      role="checkbox"
      aria-checked={pinned}
      aria-label={disabled ? `最多钉住 ${PINNED_MAX} 个` : "钉到底栏"}
      title={disabled ? `最多钉住 ${PINNED_MAX} 个` : "钉到底栏"}
      disabled={disabled}
      className={`settings-menu-pin${pinned ? " is-checked" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
    >
      {pinned && <Check size={10} aria-hidden />}
    </button>
  );
}

export function SidebarSettingsCluster() {
  const [open, setOpen] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<SettingsActionId[]>(loadPinned);
  const [version, setVersion] = useState("0.1.0");
  /* toggle 占位态:仅用于演示 active 视觉,未接真实能力。 */
  const [gitGraphActive, setGitGraphActive] = useState(false);
  /* 网络代理 active = 设置里的启用态(network-proxy 插件写入)。 */
  const { settings } = useSettingsState();
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

  const persistPinned = (next: SettingsActionId[]) => {
    setPinnedIds(next);
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
  };

  const togglePinned = (id: SettingsActionId) => {
    if (pinnedIds.includes(id)) {
      persistPinned(pinnedIds.filter((p) => p !== id));
    } else if (pinnedIds.length < PINNED_MAX) {
      persistPinned([...pinnedIds, id]);
    }
  };

  const placeholder = (name: string) => () => {
    // eslint-disable-next-line no-console
    console.info(`[settings-cluster] placeholder action: ${name}`);
  };

  const actions: SettingsAction[] = [
    {
      id: "lock",
      label: "锁屏",
      icon: <Lock size={14} aria-hidden />,
      onSelect: placeholder("lock"),
    },
    {
      id: "git-graph",
      label: "Git Graph",
      icon: <GitCommitHorizontal size={14} aria-hidden />,
      active: gitGraphActive,
      onSelect: () => setGitGraphActive((v) => !v),
    },
    {
      id: "system-proxy",
      label: "网络代理",
      icon: <Network size={14} aria-hidden />,
      active: settings.networkProxyEnabled,
      onSelect: () => {
        /* 经内核事件总线唤起 network-proxy 插件浮层:壳与插件互不引用。
           锚点 = 本簇右缘(浮层开在右侧,自身做视口夹取)。 */
        const rect = rootRef.current?.getBoundingClientRect();
        host.events.emit("plugin.network-proxy.popover.open", {
          x: (rect?.right ?? 0) + 8,
          y: rect?.top ?? 0,
        });
      },
    },
    {
      id: "runtime-notice",
      label: "运行时提示",
      icon: <CircleAlert size={14} aria-hidden />,
      onSelect: placeholder("runtime-notice"),
    },
  ];

  const pinnedActions = pinnedIds
    .map((id) => actions.find((a) => a.id === id))
    .filter((a): a is SettingsAction => Boolean(a));
  const atPinLimit = pinnedIds.length >= PINNED_MAX;

  const select = (action: SettingsAction) => {
    setOpen(false);
    action.onSelect();
  };

  return (
    <div className="settings-cluster" ref={rootRef}>
      {open && (
        <div className="settings-menu" role="menu" aria-label="设置菜单">
          {actions.map((action) => {
            const pinned = pinnedIds.includes(action.id);
            return (
              <div
                key={action.id}
                className={`settings-menu-row${action.active ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="settings-menu-item"
                  onClick={() => select(action)}
                >
                  <span className="settings-menu-icon">{action.icon}</span>
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
            <span className="settings-menu-icon">
              <Settings size={14} aria-hidden />
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
        {pinnedActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`settings-bar-btn${action.active ? " is-active" : ""}`}
            aria-label={action.label}
            aria-pressed={action.active}
            title={action.label}
            onClick={() => action.onSelect()}
          >
            {action.icon}
          </button>
        ))}
        <span className="settings-cluster-spacer" />
        <span className="settings-cluster-version">v{version}</span>
      </div>
    </div>
  );
}
