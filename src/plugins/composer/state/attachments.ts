/**
 * 附件 store —— 独立于 session,保存当前 composer 已拖入/粘贴的文件。
 *
 * 状态结构:
 * - Attachment: { id, path, name, kind, size, thumbDataUrl?, previewDataUrl? }
 * - 数组顺序 = 拖入顺序;按 data-id 索引管理
 *
 * 双向同步契约:
 * - Composer 提供 onTextMutation 回调,store 不直接改 textarea;
 *   view 层在 attachments 变化时同步重写 textarea 里的 "@path " 文本
 *
 * 反向(textarea 里删 token → 移除附件)由 Composer 在 value 变化时比对 token 列表处理
 * (textarea 内部是 text node,MutationObserver 抓不到字符级删除)。
 */

export type AttachmentKind = "image" | "pdf" | "code" | "file";

export interface Attachment {
  id: string;
  /** 临时文件绝对路径(ipc.fsWriteTemp 返回) */
  path: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  /** 图片缩略图 dataURL(canvas 128px),非图片为 null */
  thumbDataUrl: string | null;
  /** 大图预览 src(2048px 适配 / 原图 ≤2048px) */
  previewDataUrl: string | null;
  createdAt: number;
}

/* ---------- 分类 ---------- */

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const CODE_EXTS  = ["ts", "tsx", "js", "jsx", "rs", "go", "py", "java", "kt", "swift", "c", "cpp", "rb", "sh", "json", "md", "css", "html", "yml", "yaml"];

export function classifyAttachment(name: string, mime: string): AttachmentKind {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || IMAGE_EXTS.includes(ext)) return "image";
  if (ext === "pdf" || m === "application/pdf") return "pdf";
  if (CODE_EXTS.includes(ext)) return "code";
  return "file";
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

/* ---------- store ---------- */

/** 附件上限,Composer 与 store 共用同一阈值。 */
export const MAX_ATTACHMENTS = 12;

interface AttachmentsState {
  list: Attachment[];
}

const state: AttachmentsState = { list: [] };
let _idSeq = 0;

const listeners = new Set<() => void>();

export function getAttachments(): readonly Attachment[] {
  return state.list;
}

export function subscribeAttachments(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function addAttachment(a: Omit<Attachment, "id" | "createdAt">): Attachment {
  if (state.list.length >= MAX_ATTACHMENTS) throw new Error(`附件已达上限 ${MAX_ATTACHMENTS}`);
  const full: Attachment = {
    ...a,
    id: "a" + (++_idSeq).toString(36) + Date.now().toString(36),
    createdAt: Date.now(),
  };
  state.list = [...state.list, full];
  emit();
  return full;
}

export function removeAttachmentById(id: string): void {
  state.list = state.list.filter((a) => a.id !== id);
  emit();
}

export function removeAttachmentByPath(path: string): void {
  state.list = state.list.filter((a) => a.path !== path);
  emit();
}

export function clearAttachments(): void {
  if (state.list.length === 0) return;
  state.list = [];
  emit();
}

export function reorderAttachment(id: string, toIndex: number): void {
  const idx = state.list.findIndex((a) => a.id === id);
  if (idx < 0 || idx === toIndex) return;
  const next = [...state.list];
  const [item] = next.splice(idx, 1);
  next.splice(toIndex, 0, item);
  state.list = next;
  emit();
}

/* ---------- 缩略图 ---------- */

/** 生成图片缩略图 dataURL;失败返回 null。 */
export async function makeImageThumb(file: File): Promise<{ thumb: string; full: string } | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await readFileAsDataUrl(file);
  const { promise, resolve } = Promise.withResolvers<{ thumb: string; full: string } | null>();

  const img = new Image();
  img.onload = () => {
    const thumbMax = 128;
    const tR = Math.min(thumbMax / img.width, thumbMax / img.height, 1);
    const t = document.createElement("canvas");
    t.width = Math.round(img.width * tR);
    t.height = Math.round(img.height * tR);
    t.getContext("2d")!.drawImage(img, 0, 0, t.width, t.height);
    const thumb = t.toDataURL("image/jpeg", 0.82);

    const fullMax = 2048;
    const fR = Math.min(fullMax / img.width, fullMax / img.height, 1);
    const full = fR < 1 ? downscaleImage(img, fR) : dataUrl;
    resolve({ thumb, full });
  };
  img.onerror = () => resolve(null);
  img.src = dataUrl;
  return promise;
}

function downscaleImage(img: HTMLImageElement, ratio: number): string {
  const f = document.createElement("canvas");
  f.width = Math.round(img.width * ratio);
  f.height = Math.round(img.height * ratio);
  f.getContext("2d")!.drawImage(img, 0, 0, f.width, f.height);
  return f.toDataURL("image/jpeg", 0.92);
}

function readFileAsDataUrl(file: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
  return promise;
}
