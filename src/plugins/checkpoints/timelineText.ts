/**
 * 时间线消息拆解 —— 用户消息原文 → 图片 / 文件附件 + 净文本。
 *
 * 图片附件由 PromptImages.extractPromptImages 承担(IMAGE_TOKEN_RE);
 * 本模块只补「非图片 @绝对路径」token 的收集与剥离,终止符类目与图片
 * 正则一致,防误吞正文。独立成新文件:时间线是新逻辑,不改审批线既有
 * 文件(用户定向);纯函数便于单测(timelineText.test.ts)。
 */

import { extractPromptImages } from "./PromptImages";

/** composer 注入的任意附件 token:@ + 绝对路径。终止符类目同 IMAGE_TOKEN_RE 但
    去掉「.」:扩展名前的点绝不能当边界(否则惰性匹配把 /a/b.ts 截成 /a/b);
    末字符必须非终止符。天花板:路径后紧跟 ASCII 句点收尾的句子不匹配
    (句号会吞进路径,干脆不匹配,原文保留)。 */
const FILE_TOKEN_RE = /@(\/[^\s@]*?[^\s@.,;:!?)\]}　，。、；：！？」』])(?=$|[\s,;:!?)\]}　，。、；：！？」』])/g;

export interface TimelineParts {
  /** 净文本:图片与文件 token 全部剥离;空串 = 纯附件消息(调用方不渲染文本块)。 */
  text: string;
  /** 图片绝对路径(去重,复用 extractPromptImages)。 */
  images: string[];
  /** 非图片文件绝对路径(去重,排除已归入图片者)。 */
  files: string[];
}

export function extractTimelineParts(raw: string): TimelineParts {
  const img = extractPromptImages(raw);
  const files = new Set<string>();
  for (const m of raw.matchAll(FILE_TOKEN_RE)) {
    if (!img.images.includes(m[1])) files.add(m[1]);
  }
  if (files.size === 0) return { text: img.text, images: img.images, files: [] };
  /* img.text 里图片 token 已剥,本趟 replace 只命中文件 token;
     剥离遗留的空白原样保留(不折叠,防误伤消息里的代码缩进)。 */
  return {
    text: img.text.replace(FILE_TOKEN_RE, "").trim(),
    images: img.images,
    files: [...files],
  };
}
