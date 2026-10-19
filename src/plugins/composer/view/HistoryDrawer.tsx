/**
 * 输入历史浏览抽屉(042 定稿)—— ⌘K 命令抽屉同款视觉框架(dialog + fixed +
 * 右滑入),内容面不同:子串过滤 + 命中高亮 + 键盘导航。
 *
 * 交互契约(与 docs/design/042-candidates/4-prompt-history.html 对齐):
 * - 打开才读:items 经 getPromptHistory 同步内存 cache 现读,订阅仅在开态挂
 *   (新发送即时刷新列表),零后台监听/零 IO;
 * - 过滤为大小写不敏感子串;↑↓ 移动选中、Enter 回填(onPick 整替草稿、光标末尾、
 *   可编辑不直发)、Esc 关闭不回填(stopPropagation 防穿透到确认弹层等);
 * - 空结果保留搜索框继续改词,不自动关抽屉;存储序(最旧在前)即列表序。
 * 状态归 Composer 局部 useState,不经 drawerOpen 三态机(定稿)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Cross } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { getPromptHistory, subscribePromptHistory } from "@kernel/promptHistory";

interface HistoryDrawerProps {
  open: boolean;
  /** fixed 锚定几何(right/bottom/maxHeight),与命令抽屉同一量测来源。 */
  style?: React.CSSProperties;
  /** 回填:整替 composer 草稿 + 光标末尾(可编辑,不直发),随后关抽屉。 */
  onPick: (text: string) => void;
  onClose: () => void;
}

/** 命中高亮:大小写不敏感子串全部命中,<mark> 渲染。 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(ql, i);
    if (at < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
  }
  return <>{parts}</>;
}

export function HistoryDrawer({ open, style, onPick, onClose }: HistoryDrawerProps) {
  const [items, setItems] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* 打开才读 + 开态订阅(新发送刷新);关闭即退订,无后台监听。 */
  useEffect(() => {
    if (!open) return;
    setItems(getPromptHistory());
    setQuery("");
    setSelected(0);
    const timer = setTimeout(() => searchRef.current?.focus(), 120);
    /* 新数组落 state:recordPrompt 原地 push/splice 返回同一引用会被 React bail out */
    const unsub = subscribePromptHistory(() => setItems([...getPromptHistory()]));
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [open]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((it) => it.toLowerCase().includes(q)) : items;
  }, [items, query]);

  /* 过滤收口:选中越界时收到最后一项。 */
  const sel = Math.min(selected, Math.max(0, rows.length - 1));

  function move(delta: number) {
    if (rows.length === 0) return;
    const next = (sel + delta + rows.length) % rows.length;
    setSelected(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  }

  function pick(text: string) {
    onPick(text);
    onClose();
  }

  return (
    <dialog
      open
      aria-label={t("输入历史")}
      aria-hidden={!open}
      inert={!open}
      /* 键盘挂在容器(焦点在搜索框):Esc 关闭不回填,stopPropagation 防穿透
         (确认弹层等 window 级 Esc 监听不应被本关闭动作连带触发) */
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return; /* IME 确认键不当导航/回填(composerTextareaKeys 同款) */
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const text = rows[sel];
          if (text !== undefined) pick(text);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className={`m-0 p-0 fixed z-50 flex w-[380px] max-w-[88%] flex-col outline-none
        rounded-xl border border-(--tmd-border) bg-(--tmd-bg-popover) shadow-[0_16px_40px_rgba(0,0,0,0.4)]
        transition-[transform,opacity] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0.24,1)]
        motion-reduce:transition-none ${open ? "translate-x-0 opacity-100" : "translate-x-[105%] opacity-0"}`}
      style={style}
    >
      {/* 搜索行:过滤 + 计数 + 清空 */}
      <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder={t("过滤输入历史…")}
          aria-label={t("过滤输入历史")}
          className="min-w-0 flex-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-sunken) px-2 py-1 text-sm text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent)"
        />
        <span className="shrink-0 font-mono text-2xs whitespace-nowrap text-(--tmd-fg-faint)">
          {t("{n} / {m} 条", { n: rows.length, m: items.length })}
        </span>
        <button
          type="button"
          title={t("清空过滤词")}
          aria-label={t("清空过滤词")}
          onClick={() => {
            setQuery("");
            setSelected(0);
            searchRef.current?.focus();
          }}
          className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        >
          <Cross size="0.75rem" />
        </button>
      </div>

      {/* 条目列表(存储序,最旧在前) */}
      <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-(--tmd-fg-muted)">
            {items.length === 0 ? t("暂无历史记录") : t("没有匹配的历史")}
          </div>
        ) : (
          rows.map((text, idx) => (
            <button
              key={text}
              type="button"
              onClick={() => pick(text)}
              onMouseEnter={() => setSelected(idx)}
              className={`block w-full cursor-pointer border-l-2 px-4 py-2 text-left transition-colors ${
                idx === sel
                  ? "border-(--tmd-accent) bg-(--tmd-accent-soft)"
                  : "border-transparent hover:bg-(--tmd-bg-hover)"
              }`}
            >
              <span className="block overflow-hidden text-sm text-(--tmd-fg-muted) break-all [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                <Highlighted text={text} query={query} />
              </span>
            </button>
          ))
        )}
      </div>

      {/* 底部图例 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-(--tmd-border) px-2.5 py-1.5 font-mono text-2xs whitespace-nowrap text-(--tmd-fg-faint)">
        <span>{t("↑↓ 选择")}</span>
        <span>{t("Enter 回填输入框(不发送)")}</span>
        <span>{t("Esc 关闭")}</span>
      </div>
    </dialog>
  );
}
