/**
 * 命令抽屉 —— 命令/技能/MCP/插件四分区,自 composer 右缘滑入(悬浮于输入区之上,
 * 不遮挡 statusbar)。v3 紧凑布局(2026-09-03 收缩垂直占用地,与 demo v2 的差异):
 * - 高度自适应内容(上限 = 容器高),不再拉满到底;标题/搜索/横排 tab 三行移除
 * - 分区切换改左缘竖排图标 rail(按实际数据渲染,文案进 title/aria-label;
 *   rail 顶部挂关闭、底部挂计数)
 * - 三种点击:⚡ send = 直接写入幕布 / ↵ insert = 插入输入框 / ⇱ open = 打开插件面板
 * - 打开时重置为「全部」;不点外自动关闭(显式关闭:开关按钮/⌘K/Esc/rail ×),
 *   ↑↓ + Enter 键盘导航(仅可见条目,焦点驻留抽屉容器 —— 搜索框已移除)
 *
 * 执行机制不在本组件:点击经 onSend/onInsert/onOpen 回调交回 Composer
 * (send 走 prepareSendPayload → host.writeSession,与手动发送同路径)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Puzzle, Server, Sparkles, SquareTerminal, X } from "lucide-react";
import { isDrawerOpen, setDrawerOpen } from "../state/drawerOpen";
import { resolveDrawerIcon, SECTION_GLYPHS, type DrawerIconComponent } from "../drawerIcons";
import type { DrawerItem, DrawerSection } from "../drawerItems";

const SECTION_ORDER: DrawerSection[] = ["command", "skill", "mcp", "plugin"];
const SECTION_META: Record<DrawerSection, { label: string; glyph: string }> = {
  command: { label: "命令", glyph: "/" },
  skill: { label: "技能", glyph: "$" },
  mcp: { label: "MCP", glyph: "⧉" },
  plugin: { label: "插件", glyph: "▣" },
};

/** 左缘 rail 分区图标(UI 铬,非 profile 协议语义;文案进 title/aria-label)。 */
const SECTION_TAB_ICONS: Record<"all" | DrawerSection, DrawerIconComponent> = {
  all: LayoutGrid,
  command: SquareTerminal,
  skill: Sparkles,
  mcp: Server,
  plugin: Puzzle,
};

/** 动作徽标:软填充色芯片(不用描边,亮色系主题下描边 pill 过于抢眼);
    颜色全部走主题 token,preset 换色自动跟随。 */
const MODE_TAG: Record<DrawerItem["action"], { label: string; cls: string; hint: string }> = {
  send: { label: "⚡ 直接发送", cls: "bg-(--tmd-accent-soft) text-(--tmd-accent)", hint: "直接发送到幕布" },
  insert: { label: "↵ 插入", cls: "bg-(--tmd-bg-hover) text-(--tmd-fg-muted)", hint: "插入输入框继续编辑" },
  open: { label: "⇱ 打开", cls: "bg-(--tmd-diff-inserted)/10 text-(--tmd-diff-inserted)", hint: "打开对应面板" },
};

function displayName(item: DrawerItem): string {
  if (item.section === "command") return `/${item.name}`;
  if (item.section === "skill") return `$${item.name}`;
  return item.name;
}

interface CommandDrawerProps {
  open: boolean;
  items: DrawerItem[];
  /** 直接发送;返回实际写入文本供 toast 展示(translate 后的 wire)。 */
  onSend: (item: DrawerItem) => string;
  onInsert: (item: DrawerItem) => void;
  onOpen: (item: DrawerItem) => void;
}

export function CommandDrawer({ open, items, onSend, onInsert, onOpen }: CommandDrawerProps) {
  const [tab, setTab] = useState<"all" | DrawerSection>("all");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const wasOpen = useRef(false);

  const sections = useMemo(
    () => SECTION_ORDER.filter((s) => items.some((it) => it.section === s)),
    [items],
  );

  /* 可见条目(tab 过滤),键盘导航的平铺序列 */
  const visible = useMemo(
    () => items.filter((it) => tab === "all" || it.section === tab),
    [items, tab],
  );

  /* 打开即重置(先重置再渲染 —— demo 阶段修过的状态残留教训),焦点驻留抽屉容器 */
  useEffect(() => {
    if (!open) return;
    setTab("all");
    setActiveIndex(-1);
    const t = setTimeout(() => asideRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open]);

  /* Esc 关闭(抽屉自身监听;⌘K 开合在 Composer,关着也要能开)。
     不做点外自动关闭:失焦误关烦人,显式关闭走 开关按钮 / ⌘K / Esc / rail × */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /* 关闭即把焦点归还 composer 输入框:打开时焦点进了抽屉容器,不还的话
     击键落进屏外容器,用户以为"键盘失灵"(仅关闭转换时,不含首挂载) */
  useEffect(() => {
    if (wasOpen.current && !open) {
      document.getElementById("composer-textarea")?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(flashTimer.current);
  }, []);

  function showToast(text: string) {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
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
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashKey(null), 480);
      showToast(`已发送到幕布:${wire}`);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        /* 320ms 内被重新打开(⌘K 快速开合)则不关,防误杀新开的抽屉 */
        if (isDrawerOpen()) return;
        setDrawerOpen(false);
      }, 320);
    } else if (item.action === "open") {
      onOpen(item);
      showToast(`已打开:${item.name}`);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
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
      ref={asideRef}
      role="dialog"
      aria-label="命令与技能面板"
      aria-hidden={!open}
      /* inert 让关闭态彻底退出焦点序列/Tab 遍历:仅 aria-hidden 挡不住
         Tab 落进屏外可聚焦控件(可聚焦元素位于 aria-hidden 内即违例) */
      inert={!open}
      tabIndex={-1}
      /* 键盘导航挂在容器上(搜索框已移除):↑↓ 移动、Enter 兜底激活。
         焦点落在按钮上时 Enter 走原生 click,此处跳过防双激活 */
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveActive(1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveActive(-1);
          return;
        }
        if (e.key === "Enter" && !(e.target as HTMLElement).closest?.("button")) {
          if (visible[activeIndex]) {
            e.preventDefault();
            activate(visible[activeIndex]);
          }
        }
      }}
      /* 高度自适应内容,上限为容器(top-7 对位顶部 statusBar);不再拉满到底 */
      className={`absolute top-7 right-0 z-30 flex max-h-[calc(100%-1.75rem)] w-[300px] max-w-[88%] flex-row outline-none
        border-l border-(--tmd-border) bg-(--tmd-bg-popover) shadow-[-16px_0_40px_rgba(0,0,0,0.35)]
        transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0.24,1)]
        motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-[105%]"}`}
    >
      {/* 左缘竖排 rail:关闭 + 分区图标切换 + 计数(文案进 title/aria-label) */}
      <div
        className="flex w-10 shrink-0 flex-col gap-1 border-r border-(--tmd-border) bg-(--tmd-bg-sunken) p-1"
        role="tablist"
        aria-orientation="vertical"
        aria-label="分区切换"
      >
        <button
          type="button"
          title="关闭 (Esc)"
          aria-label="关闭"
          onClick={() => setDrawerOpen(false)}
          className="grid h-7 w-full cursor-pointer place-items-center rounded-md text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        >
          <X size={13} />
        </button>
        {(["all", ...sections] as const).map((key) => {
          const label = key === "all" ? "全部" : SECTION_META[key].label;
          const Icon = SECTION_TAB_ICONS[key];
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-label={label}
              title={label}
              onClick={() => { setTab(key); setActiveIndex(-1); }}
              className={`grid h-7 w-full cursor-pointer place-items-center rounded-md transition-colors ${
                tab === key
                  ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
                  : "text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
              }`}
            >
              <Icon size={13} />
            </button>
          );
        })}
        <span
          title={`${visible.length} 项`}
          className="mt-auto pt-1 text-center font-mono text-[9.5px] text-(--tmd-fg-faint)"
        >
          {visible.length}
        </span>
      </div>

      {/* 右侧:条目列表 + 底部图例 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-2">
          {sections.map((sec) => {
            const secItems = visible.filter((it) => it.section === sec);
            if (secItems.length === 0) return null;
            return (
              <div key={sec}>
                {/* 单分区视图由 rail 标示当前区,组头只在「全部」聚合时出现 */}
                {tab === "all" && (
                  <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-(--tmd-bg-popover) px-1.5 py-2 text-[10px] tracking-widest text-(--tmd-fg-faint)">
                    <span className="w-4 text-center font-mono text-[11px] text-(--tmd-fg-muted)">
                      {SECTION_GLYPHS[sec] ?? SECTION_META[sec].glyph}
                    </span>
                    <span>{SECTION_META[sec].label} · {secItems.length}</span>
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
                      title={tag.hint}
                      onClick={() => activate(item)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left font-mono transition-colors ${
                        idx === activeIndex ? "bg-(--tmd-bg-hover)" : ""
                      } ${flashKey === key ? "bg-(--tmd-accent-soft)" : ""}`}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-(--tmd-bg-hover) text-(--tmd-fg-muted)">
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
                      <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] ${tag.cls}`}>
                        {tag.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="py-6 text-center text-[11px] text-(--tmd-fg-faint)">暂无命令或技能</div>
          )}
        </div>

        {/* 底部图例 */}
        <div className="flex shrink-0 items-center gap-2 border-t border-(--tmd-border) px-2.5 py-1.5 font-mono text-[9.5px] whitespace-nowrap text-(--tmd-fg-faint)">
          <span>⚡ 直接发送到幕布</span>
          <span>↵ 插入输入框</span>
          <span>⇱ 打开面板</span>
        </div>
      </div>

      {/* 发送/打开反馈 toast */}
      <div
        role="status"
        className={`pointer-events-none absolute bottom-8 left-16 rounded-lg border border-(--tmd-border-strong) bg-(--tmd-bg-popover) px-3 py-1.5 font-mono text-[11px] text-(--tmd-fg) shadow-lg transition-all ${
          toast ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"
        }`}
      >
        {toast}
      </div>
    </aside>
  );
}
