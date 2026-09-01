/**
 * 默认文件视觉 provider —— 通过 kernel/fileVisual 注册点暴露。
 *
 * 视觉规范严格复刻 codemoss 文件树:
 * - 文件夹统一灰色轮廓(展开换开口造型)。
 * - 文件按扩展名/文件名映射到 brand-color SVG (JS 黄色 hex / TS 蓝色 hex /
 *   markdown 深灰框 / git 红色菱形 / eslint 紫色六边形 / shell 绿色 chevron)。
 * - 颜色名仅控制文字颜色;文件图标本身携带 SVG 内部固定色。
 */

import type { FileVisualProvider } from "@kernel/fileVisual";
import { getFileTreeIconSvg } from "./utils/fileTreeIcons";

/** 文件夹/普通文件统一灰色文字;icon 颜色由 SVG 内部固定。 */
const DEFAULT_COLOR = "text-(--tmd-fg)";

export const defaultFileVisualProvider: FileVisualProvider = {
  order: 100,
  match(name, isDir, expanded = false) {
    return {
      svgHtml: getFileTreeIconSvg(name, isDir, expanded),
      colorClass: DEFAULT_COLOR,
    };
  },
};