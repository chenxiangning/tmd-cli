/**
 * 统一搜索抽屉入口 —— 左栏顶部单行条目,展开内联列出全部搜索能力
 * (全文搜索 ⇧⌘F / 文件名快开 ⌘P / 会话历史 ⌘O)。
 * 命令经 kernel 注册表分发(getCommands 按 id 取 run),不 import 各插件;
 * 标题与键位标签取自注册表实况(改键后自动跟随,i18n 复用命令标题零新键)。
 * 折叠态持久化与学堂入口同语义(tmd.academy.entryCollapsed 先例,缺省展开)。
 */

import { useState } from "react";
import { CaretDown, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { formatKeybinding, getCommands, useCommands } from "@kernel/shortcuts";
import { getEffectiveKeybinding } from "@kernel/shortcutOverrides";
import { t } from "@kernel/i18n";

const MENU_ITEMS = [
  { id: "search.panel", fallback: "全文搜索" },
  { id: "search.quickOpen", fallback: "文件名快开" },
  { id: "session-search.open", fallback: "搜索会话历史…" },
];

const COLLAPSED_KEY = "tmd.search.entryCollapsed";

export function SearchHubEntry() {
  /* 折叠持久化:单消费者组件,useState 惰性首读即可,不值得上 store。 */
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  /* 订阅注册表(含改键版本):键帽与标题随 overrides 即时跟随,与设置清单同源。 */
  const commands = useCommands();
  const toggle = (): void => {
    const next = !collapsed;
    localStorage.setItem(COLLAPSED_KEY, next ? "0" : "1");
    setCollapsed(next);
  };
  const run = (id: string): void => {
    getCommands().find((c) => c.id === id)?.run();
  };

  return (
    <div className="shrink-0 pb-1 text-[0.75rem]">
      <button
        type="button"
        className="flex h-6 w-full items-center gap-1 rounded px-1.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        aria-expanded={!collapsed}
        title={collapsed ? t("展开搜索") : t("收起搜索")}
        onClick={toggle}
      >
        <MagnifyingGlass size="0.6875rem" aria-hidden />
        <span className="flex-1 truncate text-left">{t("搜索")}</span>
        {collapsed ? (
          <CaretRight size="0.625rem" aria-hidden />
        ) : (
          <CaretDown size="0.625rem" aria-hidden />
        )}
      </button>
      {!collapsed &&
        MENU_ITEMS.map((item) => {
          const cmd = commands.find((c) => c.id === item.id);
          const kb = cmd ? getEffectiveKeybinding(cmd.id) : undefined;
          return (
            <button
              key={item.id}
              type="button"
              className="flex h-6 w-full items-center gap-2 rounded pl-5 pr-1.5 text-left text-[0.75rem] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
              onClick={() => run(item.id)}
            >
              <span className="flex-1 truncate">{cmd?.title ?? t(item.fallback)}</span>
              {kb && (
                <span className="shrink-0 text-[0.6875rem] text-(--tmd-fg-faint)">
                  {formatKeybinding(kb)}
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}
