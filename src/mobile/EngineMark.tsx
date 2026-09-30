/**
 * 引擎品牌标记 —— 命中品牌 glyph(cli-shared/engineGlyphs 单一来源,
 * 前缀映射同源 engineGlyphOf)渲染 SVG,未命中回落文字缩写(remote.glyphOf);
 * home 行 / 子分组头 / session·history 顶栏共用。
 */
import { engineGlyphOf } from "@plugins/cli-shared/engineGlyphMap";
import { glyphOf } from "./remote";

export function EngineMark(props: { profileId: string }) {
  const Brand = engineGlyphOf(props.profileId);
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
