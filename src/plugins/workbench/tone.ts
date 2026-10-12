/**
 * 工作台 · 语气 → 设计令牌色映射(纯函数,自 ui.tsx 拆出守
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
