/**
 * 发送变换 —— 把「已入对话」(staged)标记序列化为 prompt 尾部引用块。
 *
 * 状态机:pending(行间/面板)→ staged(发送到对话,芯片条可见)→ sent(发送
 * 完成,不再注入)。transform 无发送成功回调,乐观翻转;发送失败可 ↩ 重发。
 */

import type { ComposerSendTransform } from "@kernel/composerExt";
import { getActiveWorkspace } from "@kernel/workspace";
import { setMarkState, stagedMarks } from "./store";
const MARK_LINE_RE = /([\w./@\\:-]+(?: [\w./@\\:-]+)*?\.[A-Za-z0-9]{1,8}):L?(\d+)(?:[-–:](\d+))?/g;

/** 引用块格式(回链正则的生成端,两边必须同步改):
 *  `文件路径:L起-L止` 独立成行,下一行起缩进摘录,最后备注行。 */
export function serializeMark(mark: {
  path: string;
  startLine: number;
  endLine: number;
  note: string;
  excerpt: string;
}): string {
  const range =
    mark.startLine === mark.endLine ? `L${mark.startLine}` : `L${mark.startLine}-L${mark.endLine}`;
  const excerpt = mark.excerpt
    .split("\n")
    .map((line) => `  > ${line}`)
    .join("\n");
  return [`${mark.path}:${range}`, excerpt, `  标注:${mark.note || "(无备注)"}`].join("\n");
}

/** 「发送到对话」:标记翻 staged,芯片条即时可见;✕ 回 pending。
 *  wire 文本由 marksSendTransform 在真实发送时注入,草稿零污染。 */
export function stageMarks(cwd: string, marks: readonly { id: string }[]): void {
  for (const mark of marks) setMarkState(cwd, mark.id, "staged");
}
export const marksSendTransform: ComposerSendTransform = (text) => {
  const cwd = getActiveWorkspace()?.root;
  if (!cwd) return text;
  const staged = stagedMarks(cwd);
  if (staged.length === 0) return text;
  const block = staged
    .map((mark) =>
      serializeMark({
        path: mark.path,
        startLine: mark.startLine,
        endLine: mark.endLine,
        note: mark.note,
        excerpt: mark.excerpt,
      }),
    )
    .join("\n\n");
  for (const mark of staged) setMarkState(cwd, mark.id, "sent");
  return `${text}\n\n请看我在文件里标记的 ${staged.length} 处:\n${block}`;
};

/** 供回链/测试复用:从行文本解析 path:L起-L止(不含 URL:// 形态)。 */
export function parseMarkRef(
  lineText: string,
): { path: string; startLine: number; endLine: number; start: number; end: number }[] {
  const out: { path: string; startLine: number; endLine: number; start: number; end: number }[] = [];
  MARK_LINE_RE.lastIndex = 0;
  for (let match = MARK_LINE_RE.exec(lineText); match; match = MARK_LINE_RE.exec(lineText)) {
    const path = match[1];
    if (path.includes("://") || (path.includes("@") && path.length > 64)) continue;
    /* 空格路径须含分隔符:防『server.ts and a.rs:L5』把整段当路径吃进 */
    if (path.includes(" ") && !/[\\/]/.test(path)) continue;
    out.push({
      path,
      startLine: Number(match[2]),
      endLine: match[3] ? Number(match[3]) : Number(match[2]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}
