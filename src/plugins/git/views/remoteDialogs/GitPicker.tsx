/**
 * GitPicker —— 远端对话框的两个下拉:RemotePicker(远端,只可选)与
 * BranchCombobox(目标远端分支,可输可选,query 过滤无匹配回退全集)。
 * 菜单 portal 到 body + fixed:对话框容器 overflow-auto 会裁剪树内 absolute。
 * 位置按触发钮 rect 计算,下方放不下且上方够放时向上展开(估高 rows*30+28,夹 120..220)。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Cloud, GitBranch } from "lucide-react";

interface MenuPos {
  x: number;
  y: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

function menuPosFrom(rect: DOMRect, rows: number): MenuPos {
  const width = Math.max(rect.width, 220);
  const maxHeight = Math.min(220, Math.max(120, rows * 30 + 28));
  const spaceBelow = window.innerHeight - rect.bottom - 16;
  const up = spaceBelow < Math.min(maxHeight, 200) && rect.top > maxHeight + 16;
  return {
    x: rect.left,
    y: up ? 0 : rect.bottom + 4,
    bottom: up ? window.innerHeight - rect.top + 4 : undefined,
    width,
    maxHeight,
  };
}

function PickerMenu({
  pos,
  children,
  onClose,
}: {
  pos: MenuPos;
  children: ReactNode;
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-1200" onPointerDown={(e) => { e.preventDefault(); onClose(); }}>
      <div
        role="listbox"
        style={{
          left: pos.x,
          top: pos.bottom === undefined ? pos.y : undefined,
          bottom: pos.bottom,
          width: pos.width,
          maxHeight: pos.maxHeight,
        }}
        className="fixed overflow-auto rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) p-1 shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 控件字段标签(Cloud/GitBranch 图标 + 文案,对齐 codemoss 表单行)。 */
export function PickerField({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="mb-1 flex items-center gap-1 text-xs text-(--tmd-fg-muted)">
      {icon}
      {label}
    </div>
  );
}

export function RemotePicker({
  remotes,
  value,
  disabled,
  onPick,
}: {
  remotes: string[];
  value: string;
  disabled?: boolean;
  onPick: (remote: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const open = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos(menuPosFrom(rect, remotes.length || 1));
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => (pos ? setPos(null) : open())}
        className="flex w-full items-center gap-1.5 rounded border border-(--tmd-border) px-2 py-1.5 font-mono text-xs text-(--tmd-fg) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
      >
        <Cloud className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-muted)" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{value || "origin"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-faint)" aria-hidden />
      </button>
      {pos && (
        <PickerMenu pos={pos} onClose={() => setPos(null)}>
          {remotes.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-(--tmd-fg-faint)">origin</div>
          )}
          {remotes.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onPick(r);
                setPos(null);
              }}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 font-mono text-xs ${
                r === value
                  ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
                  : "text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
              }`}
            >
              <Cloud className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-muted)" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">{r}</span>
              {r === value && <Check className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ))}
        </PickerMenu>
      )}
    </>
  );
}

export function BranchCombobox({
  value,
  placeholder,
  options,
  disabled,
  onChange,
}: {
  value: string;
  placeholder: string;
  /** 候选叶子名(已剥 <remote>/ 前缀) */
  options: string[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [query, setQuery] = useState<string | null>(null);

  const filtered =
    query == null
      ? options
      : options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  const shown = filtered.length > 0 ? filtered : options;

  const openMenu = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setPos(menuPosFrom(rect, Math.min(shown.length, 8)));
  };
  const openWith = (q: string) => {
    setQuery(q);
    openMenu();
  };

  /* 打开期间 input 显示 query(可继续过滤);关闭还原为已选值。 */
  useEffect(() => {
    if (pos) inputRef.current?.focus();
  }, [pos]);

  return (
    <div ref={wrapRef} className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={pos ? (query ?? "") : value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          openWith(e.target.value);
        }}
        onFocus={() => !pos && openMenu()}
        spellCheck={false}
        className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-transparent px-2 py-1.5 font-mono text-xs text-(--tmd-fg) placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent) focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        disabled={disabled}
        aria-label="目标远端分支 toggle"
        onClick={() => (pos ? setPos(null) : openWith(""))}
        className="shrink-0 rounded border border-(--tmd-border) p-1.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {pos && (
        <PickerMenu pos={pos} onClose={() => setPos(null)}>
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-(--tmd-fg-faint)">
              该远端暂无可选分支,可手写输入。
            </div>
          )}
          {shown.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onChange(o);
                setQuery(null);
                setPos(null);
              }}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 font-mono text-xs ${
                o === value.trim()
                  ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
                  : "text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
              }`}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-muted)" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">{o}</span>
              {o === value.trim() && <Check className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ))}
        </PickerMenu>
      )}
    </div>
  );
}
