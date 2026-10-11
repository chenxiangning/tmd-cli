/**
 * 工作台 · 语气/模块 → 设计令牌色映射(纯函数,自 ui.tsx 拆出守
 * only-export-components;组件与图表共用)。
 */

/** 语气 → 令牌色(risk/status tone 统一入口)。 */
export function toneVar(tone: string): string {
  switch (tone) {
    case "danger": return "var(--tmd-err)";
    case "warn": return "var(--tmd-warn)";
    case "ok": return "var(--tmd-ok)";
    case "info": return "var(--tmd-accent)";
    default: return "var(--tmd-fg-faint)";
  }
}

/** 模块强调色 → 令牌(indigo/teal/… 全走既有 accent 系,避免自造色板)。 */
export function accentVar(accent: string): string {
  switch (accent) {
    case "teal": return "var(--tmd-ok)";
    case "amber": return "var(--tmd-warn)";
    case "rose": return "var(--tmd-err)";
    case "violet": case "cyan": case "indigo": return "var(--tmd-accent)";
    default: return "var(--tmd-accent)";
  }
}
