/**
 * 引擎品牌标记 —— 命中品牌 glyph(cli-shared/engineGlyphs 单一来源)渲染 SVG,
 * 未命中回落文字缩写(remote.glyphOf);home 行 / 子分组头 / session·history 顶栏共用。
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
} from "@plugins/cli-shared/engineGlyphs";
import { glyphOf } from "./remote";

/** profileId(小写前缀)→ 品牌字形;未命中回 null(UI 回落文字 glyph)。 */
function engineGlyph(profileId: string): ComponentType<{ size: number | string }> | null {
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

export function EngineMark(props: { profileId: string }) {
  const Brand = engineGlyph(props.profileId);
  if (Brand) {
    return (
      <span className="glyph glyph-brand">
        <Brand size="0.75rem" />
      </span>
    );
  }
  const g = glyphOf(props.profileId);
  return <span className={`glyph ${g.cls}`}>{g.text}</span>;
}
