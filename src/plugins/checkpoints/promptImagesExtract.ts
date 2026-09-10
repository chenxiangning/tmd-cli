/**
 * composer 图片附件 token 剥离 —— 审批线消息卡与时间线共用的纯函数。
 * 自 PromptImages.tsx 拆出(only-export-components):缩略图渲染件留在
 * PromptImages.tsx,本文件只留 token 正则与剥离逻辑。
 */

/** composer 图片附件 token:@ + 绝对路径 + 图片扩展名;后随空白/句读/结尾才判定,防误吞正文。 */
const IMAGE_TOKEN_RE =
  /@(\/[^\s@]+?\.(?:png|jpe?g|gif|webp|bmp|avif|svg))(?=$|[\s,.;:!?)\]}　，。、；：！？」』])/gi;

export interface PromptImagesExtract {
  /** 去重后的图片绝对路径(按出现顺序)。 */
  images: string[];
  /** 剥离图片 token 后的净文本(空白折叠;纯附件消息为空串)。 */
  text: string;
}

export function extractPromptImages(prompt: string): PromptImagesExtract {
  const images: string[] = [];
  const seen = new Set<string>();
  for (const m of prompt.matchAll(IMAGE_TOKEN_RE)) {
    const path = m[1];
    if (!seen.has(path)) {
      seen.add(path);
      images.push(path);
    }
  }
  if (images.length === 0) return { images, text: prompt };
  const text = prompt
    .replace(IMAGE_TOKEN_RE, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { images, text };
}
