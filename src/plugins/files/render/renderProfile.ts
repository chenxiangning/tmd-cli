/**
 * 文件渲染档案 —— 照抄 codemoss fileRenderProfile.ts。
 *
 * 按扩展名/文件名把文件分派到 9 种渲染形态(image/pdf/tabular/document/
 * structured/markdown/code/text/binary-unsupported),是文件 tab 分发的唯一依据。
 * 与 codemoss 差异:
 * - 砍掉 previewLanguage/editorLanguage/editCapability(tmd 的编辑器走 cmLanguage,
 *   文本类一律可编辑,不需要 profile 再判);
 * - code/text 合并为 code(只影响 codemoss 高亮语言选择,tmd 统一进 CodeMirror);
 * - 预算系统只保留 structured 内部的解析上限(FileStructuredPreview 自带),
 *   code/markdown 不引入低成本降级 —— md 管线已单独优化,文本读取侧 Rust 已有 512KB 闸。
 */

type StructuredPreviewKind = "shell" | "dockerfile";

type FileRenderKind =
  | "image"
  | "markdown"
  | "structured"
  | "code"
  | "text"
  | "pdf"
  | "tabular"
  | "document"
  | "binary-unsupported";

type FilePreviewMode =
  | "image-preview"
  | "markdown-preview"
  | "structured-preview"
  | "code-preview"
  | "text-preview"
  | "pdf-preview"
  | "tabular-preview"
  | "document-preview"
  | "binary-unsupported";

type FileRenderProfile = {
  kind: FileRenderKind;
  previewMode: FilePreviewMode;
  extension: string | null;
  normalizedLookupPath: string;
  structuredKind: StructuredPreviewKind | null;
};

/* 静态扩展名/文件名查表(Record 而非 Set:纯字符串键、无运行时增删)。 */
const MARKDOWN_EXTENSIONS: Record<string, true> = { md: true, mdx: true };

const IMAGE_EXTENSIONS: Record<string, true> = {
  png: true, jpg: true, jpeg: true, gif: true, svg: true, webp: true,
  avif: true, bmp: true, heic: true, heif: true, tif: true, tiff: true, ico: true,
};

const PDF_EXTENSIONS: Record<string, true> = { pdf: true };

const TABULAR_TEXT_EXTENSIONS: Record<string, true> = { csv: true };

const TABULAR_BINARY_EXTENSIONS: Record<string, true> = { xls: true, xlsx: true };

const DOCUMENT_EXTENSIONS: Record<string, true> = { doc: true, docx: true };

const BINARY_EXTENSIONS: Record<string, true> = {
  ...IMAGE_EXTENSIONS,
  mp3: true, wav: true, ogg: true, flac: true, aac: true, m4a: true, wma: true,
  mp4: true, mov: true, avi: true, mkv: true, wmv: true, flv: true, webm: true,
  zip: true, tar: true, gz: true, rar: true, "7z": true, bz2: true,
  ...PDF_EXTENSIONS,
  ...TABULAR_BINARY_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ppt: true, pptx: true,
  exe: true, dll: true, so: true, dylib: true, bin: true, dmg: true, iso: true,
  ttf: true, otf: true, woff: true, woff2: true, eot: true,
  class: true, o: true, a: true, lib: true, pyc: true, wasm: true,
};

const SHELL_SCRIPT_EXTENSIONS: Record<string, true> = {
  sh: true, bash: true, zsh: true, ksh: true, dash: true, command: true,
};

const SHELL_SCRIPT_FILENAMES: Record<string, true> = {
  ".envrc": true, envrc: true,
  ".bashrc": true, bashrc: true,
  ".zshrc": true, zshrc: true,
  ".kshrc": true, kshrc: true,
  ".profile": true, profile: true,
};

function normalizeRenderLookupPath(path?: string | null) {
  return (path ?? "").replace(/\\/g, "/");
}

export function fileNameMatchKeyFromPath(path?: string | null) {
  const normalized = normalizeRenderLookupPath(path);
  return (normalized.split("/").pop() ?? normalized).toLowerCase();
}

export function fileExtensionFromPath(path?: string | null) {
  const fileName = fileNameMatchKeyFromPath(path);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return null;
  }
  return fileName.slice(dotIndex + 1);
}

function isImagePath(path?: string | null) {
  const ext = fileExtensionFromPath(path);
  return ext != null && IMAGE_EXTENSIONS[ext] === true;
}

function isPdfPath(path?: string | null) {
  const ext = fileExtensionFromPath(path);
  return ext != null && PDF_EXTENSIONS[ext] === true;
}

function isTabularPath(path?: string | null) {
  const ext = fileExtensionFromPath(path);
  return (
    ext != null &&
    (TABULAR_TEXT_EXTENSIONS[ext] === true || TABULAR_BINARY_EXTENSIONS[ext] === true)
  );
}

/** xls/xlsx(二进制表格):需要走 readBinaryFileBase64 字节通道,区别于 csv 文本。 */
export function isTabularBinaryPath(path?: string | null) {
  const ext = fileExtensionFromPath(path);
  return ext != null && TABULAR_BINARY_EXTENSIONS[ext] === true;
}

function isDocumentPath(path?: string | null) {
  const ext = fileExtensionFromPath(path);
  return ext != null && DOCUMENT_EXTENSIONS[ext] === true;
}

function isBinaryPath(path?: string | null) {
  const ext = fileExtensionFromPath(path);
  return ext != null && BINARY_EXTENSIONS[ext] === true;
}

export function resolveStructuredPreviewKind(path: string): StructuredPreviewKind | null {
  const fileName = fileNameMatchKeyFromPath(path);
  if (!fileName) {
    return null;
  }
  if (/^dockerfile(?:\.[^/]+)?$/i.test(fileName)) {
    return "dockerfile";
  }
  if (SHELL_SCRIPT_FILENAMES[fileName] === true) {
    return "shell";
  }
  const extension = fileExtensionFromPath(fileName);
  if (extension != null && SHELL_SCRIPT_EXTENSIONS[extension] === true) {
    return "shell";
  }
  return null;
}

export function resolveFileRenderProfile(path?: string | null): FileRenderProfile {
  const normalizedLookupPath = normalizeRenderLookupPath(path);
  const extension = fileExtensionFromPath(path);
  const structuredKind = normalizedLookupPath
    ? resolveStructuredPreviewKind(normalizedLookupPath)
    : null;

  if (isImagePath(normalizedLookupPath)) {
    return { kind: "image", previewMode: "image-preview", extension, normalizedLookupPath, structuredKind: null };
  }
  if (isPdfPath(normalizedLookupPath)) {
    return { kind: "pdf", previewMode: "pdf-preview", extension, normalizedLookupPath, structuredKind: null };
  }
  if (isTabularPath(normalizedLookupPath)) {
    return { kind: "tabular", previewMode: "tabular-preview", extension, normalizedLookupPath, structuredKind: null };
  }
  if (isDocumentPath(normalizedLookupPath)) {
    return { kind: "document", previewMode: "document-preview", extension, normalizedLookupPath, structuredKind: null };
  }
  if (isBinaryPath(normalizedLookupPath)) {
    return { kind: "binary-unsupported", previewMode: "binary-unsupported", extension, normalizedLookupPath, structuredKind: null };
  }
  if (MARKDOWN_EXTENSIONS[extension ?? ""] === true) {
    return { kind: "markdown", previewMode: "markdown-preview", extension, normalizedLookupPath, structuredKind: null };
  }
  if (structuredKind) {
    return { kind: "structured", previewMode: "structured-preview", extension, normalizedLookupPath, structuredKind };
  }
  return { kind: "code", previewMode: "code-preview", extension, normalizedLookupPath, structuredKind: null };
}
