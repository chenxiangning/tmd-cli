/**
 * 发送变换 —— 把「待发送」标记序列化为 prompt 尾部引用块(assets 先例同构)。
 *
 * 状态机消解 council 分歧:只序列化 pending(待发送)标记,发送后翻 sent,
 * 已发送不再注入(无选中恒等返回)——标记本体常驻面板/行间可见,可 ↩ 重发。
 * 注意:transform 无发送成功回调,乐观翻转;若发送失败用户可 ↩ 重发。
 */

import type { ComposerSendTransform } from "@kernel/composerExt";
import { getActiveWorkspace } from "@kernel/workspace";
import { pendingMarks, setMarkState } from "./store";

const MARK_LINE_RE = /([\w./@\\:-]+?\.[A-Za-z0-9]{1,8}):L?(\d+)(?:[-–:](\d+))?/g;

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

export const marksSendTransform: ComposerSendTransform = (text) => {
  const cwd = getActiveWorkspace()?.root;
  if (!cwd) return text;
  const pending = pendingMarks(cwd);
  if (pending.length === 0) return text;
  const block = pending
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
  for (const mark of pending) setMarkState(cwd, mark.id, "sent");
  return `${text}\n\n请看我在文件里标记的 ${pending.length} 处:\n${block}`;
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
