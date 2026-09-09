/**
 * StyledSelect —— 全设置页统一的美化下拉(kernel 通用 UI 原语,替代原生 <select>)。
 *
 * 原生 select 的弹层走操作系统渲染,与主题脱节且不可定制;
 * 本组件 = 按钮 + 主题化弹层(选项行 hover/选中对勾/超 10 项自动搜索框)。
 * 准入:cli-config 配置表单 + 设置页外观/行为三处;无 CLI 私有知识。
 */

import { useEffect, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export interface StyledSelectOption {
  value: string;
  label?: string;
  /** 右侧弱化备注(如「已登录」「未安装」)。 */
  hint?: string;
  disabled?: boolean;
}

export function StyledSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  placeholder,
  disabled,
}: {
  value: string;
  options: StyledSelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      setQuery("");
    };
  }, [open]);

  // Esc 关弹层:React 合成层 stopPropagation,阻断到达 document 的面板关面板监听
  const onEsc = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    setOpen(false);
    (e.target as HTMLElement).closest(".styled-select")
      ?.querySelector<HTMLButtonElement>(".styled-select-btn")
      ?.focus();
  };


  const current = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter(
        (o) =>
          o.value.toLowerCase().includes(query.toLowerCase()) ||
          (o.label ?? "").toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  return (
    <div ref={rootRef} className={`styled-select${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className={`styled-select-btn${open ? " is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
        onKeyDown={onEsc}
      >
        <span className={`styled-select-value${current ? "" : " is-placeholder"}`}>
          {current ? (current.label ?? current.value) : (placeholder ?? value ?? "")}
        </span>
        <CaretDown size={10} weight="bold" aria-hidden />
      </button>
      {open && (
        <div className="styled-select-pop" role="listbox" onKeyDown={onEsc}>
          {options.length > 10 && (
            <input
              className="styled-select-search"
              placeholder={t("搜索…")}
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onEsc}
            />
          )}
          <div className="styled-select-list">
            {filtered.length === 0 && (
              <div className="styled-select-empty">{t("无匹配项")}</div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                disabled={o.disabled}
                className={`styled-select-opt${o.value === value ? " is-active" : ""}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="styled-select-opt-label">{o.label ?? o.value}</span>
                {o.hint && <span className="styled-select-hint">{o.hint}</span>}
                <span className="styled-select-opt-check">
                  {o.value === value && <Check size={12} weight="bold" aria-hidden />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
