/**
 * 命令抽屉条目列表 —— 自 CommandDrawer.tsx 拆出(文件规模铁则)。
 * 右列:分区组头(仅「全部」聚合时)+ 条目按钮(图标/名称/描述/动作徽标)
 * + 底部图例。键盘导航索引与激活回调由 CommandDrawer 持有。
 */

import { resolveDrawerIcon, SECTION_GLYPHS } from "../drawerIcons";
import { t } from "@kernel/i18n";
import type { DrawerItem, DrawerSection } from "../drawerItems";
import { displayName, MODE_TAG, SECTION_META } from "./drawerSections";

export function DrawerItemList({
  sections,
  visible,
  tab,
  activeIndex,
  flashKey,
  itemRefs,
  onActivate,
  onHoverIndex,
}: {
  sections: DrawerSection[];
  visible: DrawerItem[];
  tab: "all" | DrawerSection;
  activeIndex: number;
  flashKey: string | null;
  itemRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  onActivate: (item: DrawerItem) => void;
  onHoverIndex: (idx: number) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-2">
        {sections.map((sec) => {
          const secItems = visible.filter((it) => it.section === sec);
          if (secItems.length === 0) return null;
          return (
            <div key={sec}>
              {/* 单分区视图由 rail 标示当前区,组头只在「全部」聚合时出现 */}
              {tab === "all" && (
                <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-(--tmd-bg-popover) px-1.5 py-2 text-[0.625rem] tracking-widest text-(--tmd-fg-faint)">
                  <span className="w-4 text-center font-mono text-[0.6875rem] text-(--tmd-fg-muted)">
                    {SECTION_GLYPHS[sec] ?? SECTION_META[sec].glyph}
                  </span>
                  <span>{t(SECTION_META[sec].label)} · {secItems.length}</span>
                  <span className="h-px flex-1 bg-(--tmd-border)" />
                </div>
              )}
              {secItems.map((item) => {
                const key = `${item.section}:${item.name}`;
                const idx = visible.indexOf(item);
                const Icon = resolveDrawerIcon(item);
                const tag = MODE_TAG[item.action];
                return (
                  <button
                    key={key}
                    type="button"
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    data-name={item.name}
                    title={t(tag.hint)}
                    onClick={() => onActivate(item)}
                    onMouseEnter={() => onHoverIndex(idx)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left font-mono transition-colors ${
                      idx === activeIndex ? "bg-(--tmd-bg-hover)" : ""
                    } ${flashKey === key ? "bg-(--tmd-accent-soft)" : ""}`}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-(--tmd-bg-hover) text-(--tmd-fg-muted)">
                      {Icon ? <Icon size="0.9375rem" /> : (SECTION_GLYPHS[item.section] ?? "·")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-(--tmd-fg)">{displayName(item)}</span>
                      {item.description && (
                        <span className="mt-px block truncate text-[0.65625rem] text-(--tmd-fg-subtle)">
                          {t(item.description)}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-px text-[0.625rem] ${tag.cls}`}>
                      {t(tag.label)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="py-6 text-center text-[0.6875rem] text-(--tmd-fg-faint)">{t("暂无命令或技能")}</div>
        )}
      </div>

      {/* 底部图例 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-(--tmd-border) px-2.5 py-1.5 font-mono text-[0.59375rem] whitespace-nowrap text-(--tmd-fg-faint)">
        <span>{t("⚡ 直接发送到幕布")}</span>
        <span>{t("↵ 插入输入框")}</span>
        <span>{t("⇱ 打开面板")}</span>
      </div>
    </div>
  );
}
