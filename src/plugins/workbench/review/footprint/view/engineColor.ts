/**
 * footprint 引擎 id → 品牌色(原型的 ENG 表;未知引擎回中性灰)。
 * 纯函数自 bits.tsx 拆出守 only-export-components。
 */

const ENGINE_COLORS: Record<string, string> = {
  claude: "#d97757",
  kimi: "#1f8fff",
  codex: "#10a37f",
  qoder: "#7c3aed",
  "qoder-cn": "#7c3aed",
  omp: "#f59e0b",
  pi: "#0ea5e9",
  gemini: "#3b82f6",
  grok: "#111827",
  dsh: "#2b9e68",
};

export function engineColor(engine: string): string {
  return ENGINE_COLORS[engine] ?? "#64748b";
}
