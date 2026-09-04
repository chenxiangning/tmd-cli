/**
 * markdown 图片路径解析 —— 照抄 codemoss FileMarkdownPreview 的图片辅助函数。
 *
 * 相对路径以所在 md 文件的 dirname 解析 → convertFileSrc 转 asset://;
 * http/data/blob/asset/file 直载;装饰符(引号/<…>/%20 编码)先剥离。
 */

import { assetUrl } from "@kernel/ipc";

const FILE_MARKDOWN_IMAGE_EXTENSION_REGEX =
  /\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const BROWSER_LOADABLE_IMAGE_SRC_REGEX = /^(?:https?:|data:|blob:|asset:)/i;

function safeDecodeMarkdownImageSrc(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripMarkdownImageDecorators(value: string) {
  return safeDecodeMarkdownImageSrc(
    value
      .trim()
      .replace(/^<(.+)>$/, "$1")
      .replace(/^['"](.+)['"]$/, "$1")
      .trim(),
  );
}

function removeUrlSuffix(value: string) {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex >= 0 ? value.slice(0, suffixIndex) : value;
}

function dirname(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
}

function normalizePathSegments(path: string) {
  const isAbsolute = path.startsWith("/");
  const segments = path.replace(/\\/g, "/").split("/");
  const resolvedSegments: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolvedSegments.length > 0 && resolvedSegments[resolvedSegments.length - 1] !== "..") {
        resolvedSegments.pop();
      } else if (!isAbsolute) {
        resolvedSegments.push(segment);
      }
      continue;
    }
    resolvedSegments.push(segment);
  }
  return `${isAbsolute ? "/" : ""}${resolvedSegments.join("/")}`;
}

function resolveLocalImagePath(src: string, sourceFilePath?: string | null) {
  const cleaned = stripMarkdownImageDecorators(src);
  if (!cleaned || BROWSER_LOADABLE_IMAGE_SRC_REGEX.test(cleaned)) {
    return null;
  }

  const pathOnly = removeUrlSuffix(cleaned);
  if (!pathOnly || !FILE_MARKDOWN_IMAGE_EXTENSION_REGEX.test(pathOnly)) {
    return null;
  }

  if (pathOnly.startsWith("file://")) {
    const withoutScheme = pathOnly.slice("file://".length);
    const withoutHost = withoutScheme.startsWith("localhost/")
      ? withoutScheme.slice("localhost/".length)
      : withoutScheme;
    return withoutHost.startsWith("/") ? withoutHost : `/${withoutHost}`;
  }

  if (
    pathOnly.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(pathOnly) ||
    /^\\\\[^\\]/.test(pathOnly)
  ) {
    return pathOnly;
  }

  const sourceDir = sourceFilePath ? dirname(sourceFilePath) : "";
  return normalizePathSegments(sourceDir ? `${sourceDir}/${pathOnly}` : pathOnly);
}

/** 返回 { src: 渲染用 URL(asset:// 或原始), localPath: 本地绝对路径(回退用) }。 */
export function resolveImageRenderSource(src: string, sourceFilePath?: string | null) {
  const cleaned = stripMarkdownImageDecorators(src);
  const localPath = resolveLocalImagePath(cleaned, sourceFilePath);
  if (!localPath) {
    return { src: cleaned, localPath: null };
  }
  try {
    return { src: assetUrl(localPath), localPath };
  } catch {
    return { src: cleaned, localPath };
  }
}
