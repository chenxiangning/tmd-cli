/**
 * 通用文件视觉注册点 —— 文件树/文件 tab/ composer @ 补全等 UI 共用。
 *
 * 任何插件可注册自己的 FileVisualProvider。默认(files 插件)提供
 * 一套 ext→颜色/图标的 fallback。
 *
 * 规则:
 * - 第一个非空 provider 返回结果即采用;否则用 fallback
 * - 只读不写,线程安全(JS 单线程)
 */

export interface FileVisualHint {
  /** 前置图标(glyph)。示例 "M↓" / "TS" / "📁"。 */
  glyph?: string;
  /** 颜色 tailwind class。示例 "text-orange-400"。 */
  colorClass?: string;
}

export interface FileVisualProvider {
  /** 优先级。小=先评估。同号按注册顺序。 */
  order?: number;
  /** 命中文件/目录返回提示;返回 null/undefined 让位下一个 provider。 */
  match(name: string, isDir: boolean): FileVisualHint | null | undefined;
}

const providers: FileVisualProvider[] = [];

export function registerFileVisual(p: FileVisualProvider): void {
  providers.push(p);
  providers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function resolveFileVisual(name: string, isDir: boolean): FileVisualHint {
  for (const p of providers) {
    const hint = p.match(name, isDir);
    if (hint) return hint;
  }
  return {};
}
