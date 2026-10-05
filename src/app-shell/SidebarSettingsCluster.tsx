/**
 * Sidebar settings cluster —— 左下角「设置菜单 + pinned 快捷 + 工作区显隐 + 版本号」。
 *
 * 布局(对齐参考截图):
 *   ┌─ 上弹菜单 ──────────────┐
 *   │ (注册表动作…)        □ │  ← 右侧复选框 = pin 到底栏
 *   │ 设置                    │
 *   └────────────────────────┘
 *   [pinned…] [工作区显隐]      v0.2.2  ← 底栏(触发钮在左缘 rail 底簇)
 *
 * 设置菜单触发钮 2026-10-04 迁左缘 rail 底(用户口径「放最左边底部」),开合态
 * 提升 AppShell 受控传入;菜单弹层仍锚本簇,视觉紧邻 rail 钮。
 *
 * 动作数据源 = kernel/sidebarActions 注册表(插件 activate 时自注册),
 * 本组件只渲染注册表与钉住状态,不认识任何具体动作 —— 与右栏面板同纪律。
 * 直挂 rail 的动作(right rail / left rail)不进菜单与底栏钉住。
 * 「设置」行是壳自有入口(openSettingsPanel),钉住/pin 上限 4 同 codemoss。
 * 版本号取 Tauri app version,浏览器 dev 环境回退 CHANGELOG 首条版本。
 * 界面缩放组已隐藏(2026-10-04):⌘+/⌘−/⌘0 键位接管(zoomCommands),
 * 数值仍走 settings.uiZoom,设置页外观卡可调。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { appVersion } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { defaultPinnedActionIds, useSidebarActions, type SidebarAction } from "@kernel/sidebarActions";
import { DecorIcon } from "@kernel/iconSet";
import { openSettingsPanel, useSettingsState } from "@kernel/settings";
import { Check, Gear } from "@phosphor-icons/react";
import { VersionPopover } from "./VersionPopover";
import { CHANGELOG_ENTRIES, isNewerVersion } from "./updateCheck";
import { useUpdatePresence } from "./updatePresence";
import { WorkspaceVisibilityPicker } from "./WorkspaceVisibilityPicker";

/** 底栏空间有限,最多外显 4 个快捷入口(同 codemoss SIDEBAR_SETTINGS_PINNED_MAX)。 */
const PINNED_MAX = 4;
const PINNED_STORAGE_KEY = "shell.settingsPinned.v1";

/** 钉住列表:localStorage 优先;空/损坏回落注册表内声明 defaultPinned 的动作
 *  (默认钉住归插件自声明,壳不持 id 名册;本函数在插件激活后才执行,注册表已就绪)。 */
function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return defaultPinnedActionIds();
    const ids = parsed.filter((v): v is string => typeof v === "string");
    return ids.length > 0 ? ids.slice(0, PINNED_MAX) : defaultPinnedActionIds();
  } catch {
    return defaultPinnedActionIds();
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
      aria-label={disabled ? t("最多钉住 {n} 个", { n: PINNED_MAX }) : t("钉到底栏")}
      title={disabled ? t("最多钉住 {n} 个", { n: PINNED_MAX }) : pinned ? t("取消钉住") : t("钉到底栏")}
      disabled={disabled}
      className={`settings-menu-pin${pinned ? " is-checked" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {pinned && <Check size="0.75rem" aria-hidden />}
    </button>
  );
}

export function SidebarSettingsCluster({
  open,
  onOpenChange,
  visOpen,
  onVisOpenChange,
}: {
  /** 设置菜单开合受控于 AppShell:触发钮在左缘 rail 底簇(2026-10-04 用户口径
   *  迁入),本簇只持菜单本体;互斥在 AppShell 事件源做,不经 prop→state effect。 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 工作区显隐菜单开合同受控于 AppShell(同角落两层菜单不叠压)。 */
  visOpen: boolean;
  onVisOpenChange: (open: boolean) => void;
}) {
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinned);
  const [version, setVersion] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutAnchor, setAboutAnchor] = useState({ x: 0, y: 0 });
  /* 订阅设置:动作的 active 是渲染期求值的 getter,设置变更(如代理开关)时本簇
     重渲、getter 重新取值;缩放组移除后本订阅只为 active 态重渲保留。 */
  useSettingsState();
  const actions = useSidebarActions();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion(null)); // 纯浏览器 dev(vite)下无 Tauri runtime,保持未知态
  }, []);
  /* 更新感应:启动节流后台检查(6h 一次),发现新版在版本号旁挂短提示。
     init 在 main.tsx boot(左栏持久化关闭时本簇不挂载,检查不能停摆)。 */
  const presence = useUpdatePresence();

  /* onOpenChange 走 ref(effect event 语义):监听器只随 open 挂卸,不因父级
   * 回调换身份反复退订重订(先例 WorkspaceVisibilityPicker 的 onOpenChangeRef)。 */
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  /* 点击外部 / Esc 关菜单。触发钮在左 rail(本簇 React 树之外):点它走按钮
   * 自身 toggle,点外判定按 data-settings-trigger 放行 —— 否则 mousedown 关 +
   * click 开 = 菜单在钮上永关不掉。 */
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-settings-trigger]")) return;
      onOpenChangeRef.current(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChangeRef.current(false);
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

  /* 循环查表先建索引:find/includes 的 O(n) 扫描降为 O(1);rail 直挂动作(右
   * rail / 左 rail)不进本簇 —— 菜单与底栏钉住一并排除,一个动作只住一处。 */
  const inCluster = (a: SidebarAction) => !a.rail && !a.leftRail;
  const actionById = new Map(actions.filter(inCluster).map((a) => [a.id, a]));
  const pinnedSet = new Set(pinnedIds);
  const pinnedActions = pinnedIds.flatMap((id) => {
    const a = actionById.get(id);
    return a ? [a] : [];
  });
  /* 迁移卫生(2026-10-04 回归审查 P1-1):钉住清单里已迁 rail/leftRail 的动作
   * 永不在本簇渲染、无菜单行可取消 —— 一次性清出,防幽灵槽位白占 PINNED_MAX 席
   * (先例:system-proxy 迁右 rail 后的存量 shell.settingsPinned.v1)。
   * 未注册 id(插件拔出)保留:插件插回即恢复,语义不变;幂等,清单干净后空转。 */
  const railMountedIds = useMemo(
    () => new Set(actions.filter((a) => a.rail || a.leftRail).map((a) => a.id)),
    [actions],
  );
  useEffect(() => {
    if (!pinnedIds.some((id) => railMountedIds.has(id))) return;
    persistPinned(pinnedIds.filter((id) => !railMountedIds.has(id)));
  }, [pinnedIds, railMountedIds]);
  /* 钉满口径 = 可见钉住数(幽灵已清,pinnedActions 即真实外显)。 */
  const atPinLimit = pinnedActions.length >= PINNED_MAX;

  /* 更新感应:发现比当前版本新的发布 → 版本号旁亮短提示。版本未知期不判定;
     展示回落 = CHANGELOG 首条(浏览器 dev 无 runtime,比硬编码占位更真实)。 */
  const fallbackVersion = CHANGELOG_ENTRIES[0]?.version ?? "?";
  const hasNewer =
    version !== null && presence.latest !== null && isNewerVersion(presence.latest.version, version);

  const select = (action: SidebarAction) => {
    onOpenChange(false);
    action.onSelect(anchor());
  };

  return (
    <div className="settings-cluster" ref={rootRef}>
      {open && (
        <div className="settings-menu" role="menu" aria-label={t("设置菜单")}>
          {actions.filter(inCluster).map((action) => {
            const pinned = pinnedSet.has(action.id);
            const isActive = action.active?.() ?? false;
            return (
              <div
                key={action.id}
                className={`settings-menu-row${isActive ? " is-active" : ""}`}
                data-action-id={action.id}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="settings-menu-item"
                  onClick={() => select(action)}
                >
                  <span className="settings-menu-icon" aria-hidden>
                    <DecorIcon id={action.id} Fallback={action.icon} size="0.875rem" />
                  </span>
                  <span className="settings-menu-label">{t(action.label)}</span>
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
              onOpenChange(false);
              openSettingsPanel();
            }}
          >
            <span className="settings-menu-icon" aria-hidden>
              <Gear size="0.875rem" />
            </span>
            <span className="settings-menu-label">{t("设置")}</span>
          </button>
        </div>
      )}

      <div className="settings-cluster-bar">
        {/* 设置触发钮已迁左缘 rail 底簇(2026-10-04 用户口径):底栏现以
            pinned 快捷/工作区显隐/版本号起头,菜单本体仍由本簇渲染。 */}
        {pinnedActions.map((action) => {
          const isActive = action.active?.() ?? false;
          return (
            <button
              key={action.id} type="button"
              className={`settings-bar-btn${isActive ? " is-active" : ""}`}
              data-action-id={action.id}
              aria-label={t(action.label)}
              aria-pressed={isActive}
              title={t(action.label)}
              onClick={() => action.onSelect(anchor())}
            >
              <DecorIcon id={action.id} Fallback={action.icon} size="1rem" />
            </button>
          );
        })}
        {/* 工作区显隐多选菜单(缩放组原位,2026-10-04):控制左栏显示哪些工作区,
            勾选恢复显示时右侧文件树跟着切一次;缩放入口改 ⌘+/⌘−/⌘0 键位。
            开合受控于 AppShell,与设置菜单互斥在事件源做(同角落两层菜单)。 */}
        <WorkspaceVisibilityPicker open={visOpen} onOpenChange={onVisOpenChange} />
        <span className="settings-cluster-spacer" />
        <button
          type="button"
          className="settings-cluster-version"
          aria-label={hasNewer ? t("版本与更新(有新版本)") : t("版本与更新")}
          title={hasNewer ? t("版本与更新(有新版本)") : t("版本与更新")}
          onClick={() => {
            const rect = rootRef.current?.getBoundingClientRect();
            /* 面板(300px)宽于侧栏:锚定簇左缘、悬于底栏上方,越界由弹窗内夹取。 */
            setAboutAnchor({ x: rect?.left ?? 0, y: rect?.top ?? 0 });
            setAboutOpen(true);
          }}
        >
          v{version ?? fallbackVersion}
          {hasNewer && <span className="version-new-hint">{t("有新版")}</span>}
        </button>
        <VersionPopover
          open={aboutOpen}
          anchor={aboutAnchor}
          currentVersion={version ?? fallbackVersion}
          onClose={() => setAboutOpen(false)}
        />
      </div>
    </div>
  );
}
