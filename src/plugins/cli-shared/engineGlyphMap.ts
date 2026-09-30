/**
 * profileId → 品牌 glyph 前缀映射 —— 自 engineGlyphs.tsx 拆出的纯映射
 * (组件文件保持 only-export-components)。消费方:mobile/EngineMark、
 * feature 插件 daily-journal 生成设置引擎行。
 */
import type { ComponentType } from "react";
import {
  ClaudeGlyph,
  CodexGlyph,
  DshGlyph,
  GrokGlyph,
  KimiGlyph,
  OmpGlyph,
  OpenCodeGlyph,
  PiGlyph,
  QoderGlyph,
} from "./engineGlyphs";

/** profileId 小写前缀 → 品牌 glyph;未命中回 null,消费方自行回落文字缩写。
 *  qoder 前缀兼收 qoder-cn 双分发版(同品牌同字形)。 */
export function engineGlyphOf(profileId: string): ComponentType<{ size: number | string }> | null {
  const p = (profileId ?? "").toLowerCase();
  if (p.startsWith("omp")) return OmpGlyph;
  if (p.startsWith("pi")) return PiGlyph;
  if (p.startsWith("claude")) return ClaudeGlyph;
  if (p.startsWith("codex")) return CodexGlyph;
  if (p.startsWith("kimi")) return KimiGlyph;
  if (p.startsWith("grok")) return GrokGlyph;
  if (p.startsWith("qoder")) return QoderGlyph;
  if (p.startsWith("opencode")) return OpenCodeGlyph;
  if (p.startsWith("dsh")) return DshGlyph;
  return null;
}
