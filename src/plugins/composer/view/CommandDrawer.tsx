/**
 * 命令抽屉 —— 命令/技能/MCP/插件四分区,自 composer 右缘滑入(悬浮于输入区之上,
 * 不遮挡 statusbar)。交互契约对照 docs/design/composer-drawer-demo.html v2:
 * - 三种点击:⚡ send = 直接写入幕布 / ↵ insert = 插入输入框 / ⇱ open = 打开插件面板
 * - 分区切换 chip 按实际数据渲染;打开时重置为「全部」并清空过滤词
 * - Esc 关闭、点外关闭、↑↓ + Enter 键盘导航(仅可见条目)
 *
 * 执行机制不在本组件:点击经 onSend/onInsert/onOpen 回调交回 Composer
 * (send 走 prepareSendPayload → host.writeSession,与手动发送同路径)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { isDrawerOpen, setDrawerOpen } from "../state/drawerOpen";
import { resolveDrawerIcon, SECTION_GLYPHS } from "../drawerIcons";
import type { DrawerItem, DrawerSection } from "../drawerItems";

const SECTION_ORDER: DrawerSection[] = ["command", "skill", "mcp", "plugin"];
const SECTION_META: Record<DrawerSection, { label: string; glyph: string }> = {
  command: { label: "命令", glyph: "/" },
  skill: { label: "技能", glyph: "$" },
  mcp: { label: "MCP", glyph: "⧉" },
  plugin: { label: "插件", glyph: "▣" },
};

const MODE_TAG: Record<DrawerItem["action"], { label: string; cls: string; hint: string }> = {
  send: { label: "⚡ 直接发送", cls: "border-(--tmd-accent) text-(--tmd-accent)", hint: "直接发送到幕布" },
  insert: { label: "↵ 插入", cls: "border-(--tmd-border) text-(--tmd-fg-subtle)", hint: "插入输入框继续编辑" },
  open: { label: "⇱ 打开", cls: "border-(--tmd-diff-inserted) text-(--tmd-diff-inserted)", hint: "打开对应面板" },
};

function displayName(item: DrawerItem): string {
  if (item.section === "command") return `/${item.name}`;
  if (item.section === "skill") return `$${item.name}`;
  return item.name;
}

export interface CommandDrawerProps {
  open: boolean;
  items: DrawerItem[];
  /** 当前 CLI 显示名(头部 badge);缺省不显示。 */
  cliName?: string;
  /** 直接发送;返回实际写入文本供 toast 展示(translate 后的 wire)。 */
  onSend: (item: DrawerItem) => string;
  onInsert: (item: DrawerItem) => void;
  onOpen: (item: DrawerItem) => void;
}

export function CommandDrawer({ open, items, cliName, onSend, onInsert, onOpen }: CommandDrawerProps) {
  const [tab, setTab] = useState<"all" | DrawerSection>("all");
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOpen = useRef(false);

  const sections = useMemo(
    () => SECTION_ORDER.filter((s) => items.some((it) => it.section === s)),
    [items],
  );

  /* 可见条目(tab + 过滤),键盘导航的平铺序列 */
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter(
      (it) =>
        (tab === "all" || it.section === tab) &&
        (!q || it.name.toLowerCase().includes(q) || (it.description ?? "").toLowerCase().includes(q)),
    );
  }, [items, tab, filter]);

  /* 打开即重置(先重置再渲染 —— demo 阶段修过的过滤词残留教训),并聚焦搜索框 */
  useEffect(() => {
    if (!open) return;
    setTab("all");
    setFilter("");
    setActiveIndex(-1);
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open]);

  /* Esc / 点外关闭(抽屉自身监听;⌘K 开合在 Composer,关着也要能开) */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawerOpen(false);
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-command-drawer],[data-drawer-toggle]")) return;
      setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  /* 关闭即把焦点归还 composer 输入框:打开时焦点进了过滤框,不还的话
     击键落进屏外输入框,用户以为"键盘失灵"(仅关闭转换时,不含首挂载) */
  useEffect(() => {
    if (wasOpen.current && !open) {
      document.getElementById("composer-textarea")?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  function moveActive(delta: number) {
    if (visible.length === 0) return;
    /* 未选中(-1)时 ↑ 应落最后一项、↓ 落第一项;-1 直接进模运算会落到 len-2 */
    const cur = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : 0;
    const next = (cur + delta + visible.length) % visible.length;
    setActiveIndex(next);
    itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
  }

  function activate(item: DrawerItem) {
    const key = `${item.section}:${item.name}`;
    if (item.action === "send") {
      const wire = onSend(item);
      /* 空串 = 无会话静默守卫(Composer sendFromDrawer):无反馈、不关闭 */
      if (!wire) return;
      setFlashKey(key);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashKey(null), 480);
      showToast(`已发送到幕布:${wire}`);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        /* 320ms 内被重新打开(⌘K 快速开合)则不关,防误杀新开的抽屉 */
        if (isDrawerOpen()) return;
        setDrawerOpen(false);
      }, 320);
    } else if (item.action === "open") {
      onOpen(item);
      showToast(`已打开:${item.name}`);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        if (isDrawerOpen()) return;
        setDrawerOpen(false);
      }, 320);
    } else {
      onInsert(item);
      setDrawerOpen(false);
    }
  }

  return (
    <aside
      id="command-drawer"
      data-command-drawer
      role="dialog"
      aria-label="命令与技能面板"
      aria-hidden={!open}
      /* inert 让关闭态彻底退出焦点序列/Tab 遍历:仅 aria-hidden 挡不住
         Tab 落进屏外可聚焦控件(可聚焦元素位于 aria-hidden 内即违例) */
      inert={!open}
      className={`absolute top-7 right-0 bottom-0 z-30 flex w-[300px] max-w-[88%] flex-col
        border-l border-(--tmd-border) bg-(--tmd-bg-popover) shadow-[-16px_0_40px_rgba(0,0,0,0.35)]
        transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0.24,1)]
        motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-[105%]"}`}
    >
      {/* 头部 */}
      <div className="flex shrink-0 items-center gap-2 px-3.5 pt-2.5 pb-2">
        <span className="text-xs font-semibold text-(--tmd-fg)">命令与技能</span>
        {cliName && (
          <span className="rounded border border-(--tmd-border-strong) px-1.5 py-px text-[9.5px] text-(--tmd-fg-subtle)">
            {cliName}
          </span>
        )}
        <button
          type="button"
          title="关闭 (Esc)"
          onClick={() => setDrawerOpen(false)}
          className="ml-auto grid h-5.5 w-5.5 place-items-center rounded-md text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        >
          <X size={13} />
        </button>
      </div>

      {/* 过滤 */}
      <div className="relative shrink-0 px-3 pb-2">
        <Search size={13} className="pointer-events-none absolute top-1/2 left-[21px] -translate-y-[calc(50%+4px)] text-(--tmd-fg-faint)" />
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setActiveIndex(-1); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.stopPropagation(); moveActive(1); }
            if (e.key === "ArrowUp") { e.stopPropagation(); moveActive(-1); }
            if (e.key === "Enter" && visible[activeIndex]) {
              e.preventDefault();
              activate(visible[activeIndex]);
            }
          }}
          placeholder="过滤命令 / 技能…"
          className="h-7 w-full rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) pr-2.5 pl-7 font-mono text-[11.5px] text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-border-strong)"
        />
      </div>

      {/* 分区切换 */}
      <div className="flex shrink-0 gap-1 px-3 pb-2.5" role="tablist" aria-label="分区切换">
        {(["all", ...sections] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => { setTab(key); setActiveIndex(-1); }}
            className={`h-6 flex-1 cursor-pointer rounded-md border font-mono text-[10.5px] whitespace-nowrap transition-colors ${
              tab === key
                ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-accent)"
                : "border-(--tmd-border) text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
            }`}
          >
            {key === "all" ? "全部" : SECTION_META[key].label}
          </button>
        ))}
      </div>

      {/* 条目列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sections.map((sec) => {
          const secItems = visible.filter((it) => it.section === sec);
          if (secItems.length === 0) return null;
          return (
            <div key={sec}>
              <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-(--tmd-bg-popover) px-1.5 py-2 text-[10px] tracking-widest text-(--tmd-fg-faint)">
                <span className="grid h-4 w-4 place-items-center rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) text-[11px] text-(--tmd-fg-muted)">
                  {SECTION_GLYPHS[sec] ?? SECTION_META[sec].glyph}
                </span>
                {SECTION_META[sec].label} · {secItems.length}
              </div>
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
                    title={tag.hint}
                    onClick={() => activate(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left font-mono transition-colors ${
                      idx === activeIndex ? "bg-(--tmd-bg-hover)" : ""
                    } ${flashKey === key ? "bg-(--tmd-accent-soft)" : ""}`}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) text-(--tmd-fg-muted)">
                      {Icon ? <Icon size={15} /> : (SECTION_GLYPHS[item.section] ?? "·")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-(--tmd-fg)">{displayName(item)}</span>
                      {item.description && (
                        <span className="mt-px block truncate text-[10.5px] text-(--tmd-fg-subtle)">
                          {item.description}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9.5px] ${tag.cls}`}>
                      {tag.label}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="py-6 text-center text-[11px] text-(--tmd-fg-faint)">没有匹配的命令或技能</div>
        )}
      </div>

      {/* 底部图例 */}
      <div className="flex shrink-0 items-center gap-2.5 border-t border-(--tmd-border) px-3.5 py-1.5 font-mono text-[9.5px] text-(--tmd-fg-faint)">
        <span>⚡ 直接发送到幕布</span>
        <span>↵ 插入输入框</span>
        <span>⇱ 打开面板</span>
        <span className="ml-auto">{visible.length} 项</span>
      </div>

      {/* 发送/打开反馈 toast */}
      <div
        role="status"
        className={`pointer-events-none absolute bottom-3 left-3 rounded-lg border border-(--tmd-border-strong) bg-(--tmd-bg-popover) px-3 py-1.5 font-mono text-[11px] text-(--tmd-fg) shadow-lg transition-all ${
          toast ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"
        }`}
      >
        {toast}
      </div>
    </aside>
  );
}
