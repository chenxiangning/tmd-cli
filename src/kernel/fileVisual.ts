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
  /** 完整 SVG HTML 字符串(由 getFileTreeIconSvg 等图标工具产出)。直接 innerHTML 进 file-tree 行。 */
  svgHtml: string;
  /** 颜色 tailwind class,作用于文件名。示例 "text-neutral-300"。 */
  colorClass: string;
}
export interface FileVisualProvider {
  /** 优先级。小=先评估。同号按注册顺序。 */
  order?: number;
  /** 命中文件/目录返回提示;返回 null/undefined 让位下一个 provider。
   * expanded 仅对 isDir=true 有意义,用于切换 folder / folder-open 图标。 */
  match(name: string, isDir: boolean, expanded?: boolean): FileVisualHint | null | undefined;
}

const providers: FileVisualProvider[] = [];

export function registerFileVisual(p: FileVisualProvider): void {
  providers.push(p);
  providers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

const FALLBACK_FILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
export function resolveFileVisual(name: string, isDir: boolean, expanded = false): FileVisualHint {
  for (const p of providers) {
    const hint = p.match(name, isDir, expanded);
    if (hint && hint.svgHtml) return hint;
  }
  return { svgHtml: FALLBACK_FILE_SVG, colorClass: "text-(--tmd-fg)" };
}
