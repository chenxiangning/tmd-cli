/**
 * 文件内容高亮注册点 —— FileTabContent 消费,files 插件默认注册 shiki。
 *
 * 任何插件可替换(files 默认 shiki;想换成 monaco 的注册新 provider)。
 * 未注册时消费方降级到 <pre> 直接渲染。
 */

export interface FileHighlighter {
  /** 是否支持该文件。 */
  supports(path: string): boolean;
  /** 返回 HTML(可能为 null,消费方降级 <pre>)。 */
  highlight(path: string, content: string): Promise<string | null>;
}

let current: FileHighlighter | null = null;

export function registerFileHighlighter(h: FileHighlighter): void {
  current = h;
}

export function getFileHighlighter(): FileHighlighter | null {
  return current;
}
