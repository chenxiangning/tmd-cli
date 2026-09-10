/**
 * Qoder 品牌 glyph —— 几何 Q 字环 + 右下尾笔(stroke 环避开发填规则坑),
 * 官方 favicon 单色(#0F0D0C/反白)→ 全对比度随主题(浅黑/深白),不再随容器灰化。
 * 双分发版共享:域逻辑在 qoderSessionModel.ts,插件装配在 qoderPlugin.tsx。
 */

export function QoderGlyph({ size }: { size: number | string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden
    >
      <circle cx="12" cy="12" r="7" fill="none" stroke="var(--tmd-fg)" strokeWidth="2.6" />
      <path fill="var(--tmd-fg)" d="M17.9 16.9 21.8 20.8 20.9 21.7 17 17.8Z" />
    </svg>
  );
}
