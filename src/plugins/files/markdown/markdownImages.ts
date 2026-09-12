/**
 * markdown 图片/链接路径解析 —— 照抄 codemoss FileMarkdownPreview 的图片辅助函数,
 * 链接目标解析为 tmd 端新增(点击分流用)。
 *
 * 图片:相对路径以所在 md 文件的 dirname 解析 → convertFileSrc 转 asset://;
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

/** 本地路径三分支:file:// 剥壳 / 绝对路径直用 / 相对路径以源文件 dirname 解析。 */
function resolveLocalFilePath(pathOnly: string, sourceFilePath?: string | null) {
  if (/^file:/i.test(pathOnly)) {
    const withoutScheme = pathOnly.replace(/^file:\/\//i, "").replace(/^file:/i, "");
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

function resolveLocalImagePath(src: string, sourceFilePath?: string | null) {
  const cleaned = stripMarkdownImageDecorators(src);
  if (!cleaned || BROWSER_LOADABLE_IMAGE_SRC_REGEX.test(cleaned)) {
    return null;
  }

  const pathOnly = removeUrlSuffix(cleaned);
  if (!pathOnly || !FILE_MARKDOWN_IMAGE_EXTENSION_REGEX.test(pathOnly)) {
    return null;
  }

  return resolveLocalFilePath(pathOnly, sourceFilePath);
}

const HREF_SCHEME_REGEX = /^([A-Za-z][A-Za-z0-9+.-]*):/;

type MarkdownLinkTarget = {
  /** 解析后的本地绝对路径(%20 等已解码)。 */
  path: string;
  /** `#` 锚点(已解码;匹配方再经 normalizeMarkdownAnchorKey 归一)。无锚点为空串。 */
  anchor: string;
};

/**
 * markdown 链接目标解析:相对(以源文件 dirname)/绝对/file:// → 本地绝对路径 +
 * 锚点。带非 file scheme 的(http 系在外层已分流;javascript:/vscode: 等)返回
 * null,调用方静默忽略 —— 任何链接都不允许触发 webview 默认导航。
 */
export function resolveMarkdownLinkTarget(
  href: string,
  sourceFilePath?: string | null,
): MarkdownLinkTarget | null {
  /* 与图片同款装饰剥离,但不在切锚点前解码:`%23` 等编码字符不应提前变成立界符。 */
  const cleaned = href.trim().replace(/^<(.+)>$/, "$1").replace(/^['"](.+)['"]$/, "$1").trim();
  if (!cleaned) {
    return null;
  }
  const schemeMatch = HREF_SCHEME_REGEX.exec(cleaned);
  if (schemeMatch) {
    const isDriveLetter = /^[A-Za-z]:[/\\]/.test(cleaned);
    const isFileScheme = schemeMatch[1].toLowerCase() === "file";
    if (!isDriveLetter && !isFileScheme) {
      return null;
    }
  }
  /* 锚点取首个 # 之后、? 之前;路径取 ? 或 # 之前(query 在前 `a.md?x=1#s` 也正确)。 */
  const hashIndex = cleaned.indexOf("#");
  const queryIndex = cleaned.indexOf("?");
  let pathEnd = cleaned.length;
  if (hashIndex >= 0) {
    pathEnd = hashIndex;
  }
  if (queryIndex >= 0 && queryIndex < pathEnd) {
    pathEnd = queryIndex;
  }
  const pathOnly = cleaned.slice(0, pathEnd);
  if (!pathOnly) {
    return null; /* 纯锚点由调用方先行分流,这里防御。 */
  }
  return {
    path: safeDecodeMarkdownImageSrc(resolveLocalFilePath(pathOnly, sourceFilePath)),
    anchor:
      hashIndex >= 0
        ? safeDecodeMarkdownImageSrc(cleaned.slice(hashIndex + 1).split("?")[0] ?? "")
        : "",
  };
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
