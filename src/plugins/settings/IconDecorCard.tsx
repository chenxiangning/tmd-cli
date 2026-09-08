/**
 * 基础设置 / 外观 tab 的图标装饰卡 —— 7 个界面图标的独立颜色与呼吸闪烁(可折叠)。
 * 键清单是 UI 知识(键 = kernel/iconDecor.ts 的 CSS 变量约定 id);全部写 kernel/settings
 * store 即时生效,应用由 kernel/iconDecor.ts 同步到 <html>,预览图标即时反映自定义色。
 */

import { useState, type ComponentType } from "react";
import {
  ArrowCounterClockwise,
  Brain,
  CaretDown,
  CaretRight,
  Folder,
  GitBranch,
  HardDrive,
  RocketLaunch,
  SealCheck,
} from "@phosphor-icons/react";
import {
  DEFAULT_ICON_DECOR,
  updateSettings,
  useSettingsState,
  type IconDecorId,
  type IconDecorItem,
} from "@kernel/settings";
import { t } from "@kernel/i18n";

/** system-proxy 的梯子图标是 network-proxy 插件内联 SVG,插件间不互 import,此处自绘同形。 */
function LadderIcon({ size = 14 }: { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 4l-3 16" />
      <path d="M18 4l3 16" />
      <path d="M6 9h12" />
      <path d="M6 14h12" />
      <path d="M4.5 19h15" />
    </svg>
  );
}

/** 装饰清单(UI 知识):id 顺序即设置卡展示顺序。 */
const ICON_DECOR_ITEMS: ReadonlyArray<{
  id: IconDecorId;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
}> = [
  { id: "newchat", label: "新建会话", icon: RocketLaunch },
  { id: "ssh-panel", label: "SSH 入口", icon: HardDrive },
  { id: "system-proxy", label: "网络代理", icon: LadderIcon },
  { id: "panel-files", label: "文件面板", icon: Folder },
  { id: "panel-git", label: "Git 面板", icon: GitBranch },
  { id: "panel-checkpoints", label: "审批线面板", icon: SealCheck },
  { id: "panel-memory", label: "Memory 面板", icon: Brain },
];

/** 取色器空值占位(无自定义色时的中性灰)。 */
const COLOR_PLACEHOLDER = "#808080";

export function IconDecorCard() {
  const { settings } = useSettingsState();
  const [collapsed, setCollapsed] = useState(false);

  const setItem = (id: IconDecorId, patch: Partial<IconDecorItem>) => {
    updateSettings({
      iconDecor: { ...settings.iconDecor, [id]: { ...settings.iconDecor[id], ...patch } },
    });
  };
  /** 恢复出厂 = 清自定义色 + blink 回出厂(newchat 回到默认开)。 */
  const resetItem = (id: IconDecorId) => {
    updateSettings({
      iconDecor: { ...settings.iconDecor, [id]: { ...DEFAULT_ICON_DECOR[id] } },
    });
  };

  return (
    <div className="pref-card" data-testid="settings-icon-decor-card">
      <button
        type="button"
        className="preset-group-label"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <CaretRight size="0.75rem" aria-hidden /> : <CaretDown size="0.75rem" aria-hidden />}
        {t("图标装饰")}
      </button>
      {!collapsed && (
        <>
          <div className="pref-desc">
            {t("逐图标自定义颜色与呼吸闪烁;有开关两态的图标仅作用于点亮色。")}
          </div>
          {ICON_DECOR_ITEMS.map(({ id, label, icon: Icon }) => {
            const item = settings.iconDecor[id];
            const isDefault =
              !item.color &&
              (item.blink ?? false) === (DEFAULT_ICON_DECOR[id].blink ?? false);
            return (
              <div className="pref-row icon-decor-row" key={id}>
                <div className="icon-decor-id">
                  <span
                    className="icon-decor-preview"
                    style={item.color ? { color: item.color } : undefined}
                  >
                    <Icon size="0.875rem" />
                  </span>
                  <span className="pref-title">{t(label)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="color"
                    className="icon-decor-color"
                    value={item.color ?? COLOR_PLACEHOLDER}
                    aria-label={`${t(label)} ${t("颜色")}`}
                    onChange={(e) => setItem(id, { color: e.target.value })}
                  />
                  <div
                    className="segmented"
                    role="radiogroup"
                    aria-label={`${t(label)} ${t("闪烁")}`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!!item.blink}
                      className={`segment${item.blink ? " is-active" : ""}`}
                      onClick={() => setItem(id, { blink: true })}
                    >
                      {t("开启")}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!item.blink}
                      className={`segment${!item.blink ? " is-active" : ""}`}
                      onClick={() => setItem(id, { blink: false })}
                    >
                      {t("关闭")}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="icon-decor-reset"
                    disabled={isDefault}
                    title={t("恢复默认")}
                    aria-label={`${t(label)} ${t("恢复默认")}`}
                    onClick={() => resetItem(id)}
                  >
                    <ArrowCounterClockwise size="0.8125rem" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
