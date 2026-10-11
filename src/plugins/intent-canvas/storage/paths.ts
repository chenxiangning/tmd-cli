import { ipc } from "@kernel/ipc";
import { asString } from "../utils/json";
import { fnv1a32 } from "@kernel/textHash";
/**
 * 意图画布 · 存储路径与 id 白名单(sidecar ~/.tmd-cli/intent-canvas/<dirKey(root)>/,移植自
 * mossx intentCanvasStorage;mossx 的 Rust 白名单校验对应物 = normalizeCanvasId)。
 */
export const INTENT_CANVAS_INDEX_PATH = "index.json";
const CANVAS_ID_PATTERN = /^canvas-[A-Za-z0-9._-]+$/;

export function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isMissingFileError(error: unknown): boolean {
  const message = normalizeErrorMessage(error).toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("no such file") ||
    message.includes("does not exist") ||
    /* Windows 缺失文案是 "The system cannot find the file specified."(zh Locale
       「系统找不到指定的文件」),不携带上述任何字样;os error 2 双平台语义恒为
       ENOENT / ERROR_FILE_NOT_FOUND,作结构化兜底(Rust read_file 未发哨兵前的锚)。 */
    message.includes("os error 2") ||
    message.includes("cannot find") ||
    message.includes("找不到")
  );
}

export function createCanvasId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `canvas-${crypto.randomUUID()}`;
  }
  return `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCanvasId(value: unknown): string | null {
  const canvasId = asString(value);
  if (!canvasId || !CANVAS_ID_PATTERN.test(canvasId)) {
    return null;
  }
  if (
    canvasId.includes("..") ||
    canvasId.includes("/") ||
    canvasId.includes("\\") ||
    canvasId.includes(":")
  ) {
    return null;
  }
  return canvasId;
}

export function resolveDocumentPath(canvasId: string): string {
  const safeCanvasId = normalizeCanvasId(canvasId);
  if (!safeCanvasId) {
    throw new Error(`Invalid Intent Canvas id: ${canvasId}`);
  }
  return `${safeCanvasId}.intent-canvas.json`;
}


/** 目录名安全的工作区键:fnv 32 位 base36(cwd 判等键;算法收口在 kernel/textHash)。 */
export function dirKey(root: string): string {
  return fnv1a32(root).toString(36);
}

/** 某工作区的画布目录(懒解析 home;目录创建归调用方)。 */
export async function canvasDir(root: string): Promise<string> {
  const home = await ipc.configHomeDir();
  return `${home}/.tmd-cli/intent-canvas/${dirKey(root)}`;
}

/** AI 作画 inbox 目录(新能力:AI 会话往这里写 ai-draw-*.json)。 */
export async function aiInboxDir(root: string): Promise<string> {
  return `${await canvasDir(root)}/inbox`;
}
