/** en 词典 · checkpoints 恢复预览段(自 misc.ts 拆出守 300 行铁则;键 = 中文源串)。 */
export const MESSAGES = {
  // 恢复 dry-run 预览(042 项6)
  "反悔 · 恢复到回退前": "Undo · restore to pre-revert state",
  "覆盖本地 {n}": "Overwrites local {n}",
  "覆盖本地": "Overwrites local",
  "快照 · 轮 {turn} · {time} · 共 {n} 文件":
    "Snapshot · turn {turn} · {time} · {n} files",
  "共 {n} 文件 · 展开其余 {m}": "{n} files total · show remaining {m}",
  "跳过:{skipped}": "Skipped: {skipped}",
  "预览不可用,已回落文案确认:{err}": "Preview unavailable, fell back to text confirmation: {err}",
  "按恢复点守卫把这批写回回退前的状态;":
    "Write this batch back to its pre-revert state from the restore-point guard;",
  "内容失配的路径会跳过,绝不覆盖": "paths with mismatched content are skipped — never overwritten",
  "确认反悔": "Confirm undo",
  "本批已无可回退的改动": "No changes left to revert in this batch",
  "按恢复点守卫把这批写回回退前的状态(复用恢复时的预览)":
    "Write this batch back to its pre-revert state from the restore-point guard (reuses the restore-time preview)",
} as Record<string, string>;
