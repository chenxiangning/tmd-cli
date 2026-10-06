/**
 * 意图画布 · 文档 CRUD(sidecar ipc.fs* 通道,移植自 mossx intentCanvasStorage)。
 * mossx 的 Rust 原子写/锁在单用户桌面 + 按钮驱动写入下不做;ponytail: 索引与文档
 * 两步写非事务,先文档后索引,半写态由下次保存自愈。
 */
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { cacheAiDrawLatestCanvas } from "../aiDrawPrompt";
import type {
  IntentCanvasDocument,
  IntentCanvasIndexEntry,
  IntentCanvasIndexFile,
  IntentCanvasLoadResult,
} from "../types";
import { buildIntentCanvasAiContext } from "../scene/sceneState";
import { buildIntentCanvasThumbnailSvg } from "../utils/thumbnail";
import {
  buildIndexEntry,
  normalizeIntentCanvasDocument,
  normalizeIndexFile,
} from "./documentCodec";
import {
  INTENT_CANVAS_INDEX_PATH,
  canvasDir,
  isMissingFileError,
  normalizeCanvasId,
  normalizeErrorMessage,
  resolveDocumentPath,
} from "./paths";

export async function loadIntentCanvasIndex(
  root: string,
): Promise<IntentCanvasLoadResult<IntentCanvasIndexEntry[]>> {
  let raw = "";
  try {
    raw = await ipc.fsReadFile(`${await canvasDir(root)}/${INTENT_CANVAS_INDEX_PATH}`);
    if (!raw) {
      cacheAiDrawLatestCanvas(root, null);
      return { value: [], warnings: [] };
    }
    const parsed = JSON.parse(raw) as unknown;
    const indexFile = normalizeIndexFile(parsed);
    const canvases = indexFile.canvases.slice().sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
    /* 作画缺省目标 = 最近更新画布(倒序首位):读后自喂同步缓存,sendTransform
       发送线程不 await 即可拿到目标(prompt 侧 aiDrawLatestCanvasSync)。 */
    cacheAiDrawLatestCanvas(root, canvases[0] ? { id: canvases[0].id, title: canvases[0].title } : null);
    return { value: canvases, warnings: [] };
  } catch (error) {
    if (isMissingFileError(error)) {
      cacheAiDrawLatestCanvas(root, null);
      return { value: [], warnings: [] };
    }
    /* 读失败不清目标缓存:旧值大概率仍指向有效画布,宁可用旧不误开新图。 */
    return {
      value: [],
      warnings: [`画布索引读取失败: ${normalizeErrorMessage(error)}`],
    };
  }
}

export async function loadIntentCanvasDocument(
  root: string,
  canvasId: string,
): Promise<IntentCanvasDocument> {
  const raw = await ipc.fsReadFile(`${await canvasDir(root)}/${resolveDocumentPath(canvasId)}`);
  const parsed = JSON.parse(raw) as unknown;
  const document = normalizeIntentCanvasDocument(parsed);
  if (!document) {
    throw new Error(`Invalid Intent Canvas document: ${canvasId}`);
  }
  return document;
}


/* 索引同受 fs_read_file 512KB 读闸:缩略图内联累积顶穿闸后索引恒读失败 →
   列表清空且保存中止索引更新(状态随保存恶化)。写前同款闸收敛:超限从
   最旧条目起剥缩略图(纯派生缓存,可重建,列表降级占位图);剥光仍超限
   (元数据自身超阈,数千画布级)才拒写。 */
const MAX_INDEX_JSON_BYTES = 496 * 1024;

async function writeIndex(root: string, entries: IntentCanvasIndexEntry[]): Promise<void> {
  let canvases = entries.slice().sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  const enc = new TextEncoder();
  const sizeOf = () => enc.encode(JSON.stringify({ version: 1, canvases } satisfies IntentCanvasIndexFile, null, 2)).byteLength;
  if (sizeOf() > MAX_INDEX_JSON_BYTES) {
    /* ponytail: 逐条剥缩略图重预算 O(n²);超限典型只差 1-2 张,量级再大改增量预算 */
    for (let i = canvases.length - 1; i >= 0; i -= 1) {
      canvases[i] = { ...canvases[i] };
      delete canvases[i].thumbnailSvg;
      if (sizeOf() <= MAX_INDEX_JSON_BYTES) break;
    }
    if (sizeOf() > MAX_INDEX_JSON_BYTES) {
      throw new Error(t("画布索引超过存储读取上限(496KB),已拒绝写入,请删除部分画布后重试。"));
    }
  }
  const indexFile: IntentCanvasIndexFile = { version: 1, canvases };
  await ipc.fsWriteFile(`${await canvasDir(root)}/${INTENT_CANVAS_INDEX_PATH}`, JSON.stringify(indexFile, null, 2));
}

/** marks store.ts 同构的两级幂等建目录:fsCreateDir 撞已存在即报错,一律吞掉。 */
async function ensureCanvasDir(root: string): Promise<void> {
  const dir = await canvasDir(root);
  await ipc.fsCreateDir(dir.slice(0, dir.lastIndexOf("/"))).catch(() => undefined);
  await ipc.fsCreateDir(dir).catch(() => undefined);
}

/* 索引 read-modify-write 串行化:保存与 AI 导入轮询是两个并发写方,交错读改写
   会以后写方快照覆盖前写方条目(条目隐身、文档滞留盘上)。单 webview 内内存锁。 */
let indexTx: Promise<unknown> = Promise.resolve();
function withIndexTx<T>(fn: () => Promise<T>): Promise<T> {
  const next = indexTx.then(fn, fn);
  indexTx = next.catch(() => undefined);
  return next;
}

/* fs_read_file 侧有 512KB 预览闸:超出即「存得进、永远打不开」。写前按读闸
   收敛(留 16KB 裕量),把不对称变成可见的保存错误而非单向门。 */
const MAX_DOCUMENT_JSON_BYTES = 496 * 1024;

/* 盘上文档比内存新(AI 导入在编辑期间落盘)时拒绝整文档覆写,防用户一次保存
   抹掉导入的图形。AI 导入自身 load-then-save 时间戳相等,不受此闸影响。 */
class CanvasStaleOverwriteError extends Error {}

async function assertNotStaleOverwrite(document: IntentCanvasDocument, path: string): Promise<void> {
  const raw = await ipc.fsReadFile(path).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return;
  }
  try {
    const existing = normalizeIntentCanvasDocument(JSON.parse(raw));
    if (existing && existing.updatedAt > document.updatedAt) {
      throw new CanvasStaleOverwriteError(
        t("画布已在其他入口更新(AI 作画导入),请返回列表重新打开后再保存,否则会覆盖新内容。"),
      );
    }
  } catch (error) {
    if (error instanceof CanvasStaleOverwriteError) {
      throw error;
    }
    /* 盘上文档损坏:不影响本次保存(保存即修复)。 */
  }
}

export async function saveIntentCanvasDocument(
  root: string,
  document: IntentCanvasDocument,
): Promise<{ document: IntentCanvasDocument; indexEntries: IntentCanvasIndexEntry[] }> {
  const now = new Date().toISOString();
  const nextDocument: IntentCanvasDocument = {
    ...document,
    updatedAt: now,
    aiContext: buildIntentCanvasAiContext(document.scene, document.summary),
  };
  const json = JSON.stringify(nextDocument, null, 2);
  if (new TextEncoder().encode(json).byteLength > MAX_DOCUMENT_JSON_BYTES) {
    throw new Error(t("画布内容超过存储读取上限(496KB),已拒绝保存,否则该画布将无法再次打开。请删除画布中的大图后重试。"));
  }
  await ensureCanvasDir(root);
  const documentPath = `${await canvasDir(root)}/${resolveDocumentPath(nextDocument.id)}`;
  /* 比较基线必须是调用方内存里的 document(加载/上次保存时刻),不能用
     已盖 now 的 nextDocument —— 否则只有「保存瞬间并发写盘」才触发,真实的
     「AI 导入发生在 load 与 save 之间」永不命中(评审 P1 残余缺口)。 */
  await assertNotStaleOverwrite(document, documentPath);
  await ipc.fsWriteFile(documentPath, json);
  const thumbnailSvg = await buildIntentCanvasThumbnailSvg(nextDocument.scene);
  const nextEntry: IntentCanvasIndexEntry = {
    ...buildIndexEntry(nextDocument),
    ...(thumbnailSvg ? { thumbnailSvg } : {}),
  };
  /* 写后索引条目随返回值带出(2026-10-06):调用方直接落列表态,免保存后
   * 再全量读一次索引(每次保存省 ~0.5MB 读 + parse)。 */
  let indexEntries: IntentCanvasIndexEntry[] = [];
  await withIndexTx(async () => {
    const indexResult = await loadIntentCanvasIndex(root);
    if (indexResult.warnings.length > 0) {
      /* 读失败时的空快照不可作覆写基线:整表覆写会把其余画布从列表抹掉且无重建
         路径。中止索引写(文档已落盘),下次成功读取后保存自愈。 */
      throw new Error(t("画布索引读取失败,已中止本次索引更新:{warning}", { warning: indexResult.warnings[0] ?? "" }));
    }
    /* 缩略图是尽力而为的派生缓存:本次导出失败(超预算/chunk 未就绪)时
       继承旧条目,大画布不至于永久回退占位图。 */
    const previous = indexResult.value.find((entry) => entry.id === nextDocument.id);
    const entryWithThumb = nextEntry.thumbnailSvg ?? (previous?.thumbnailSvg ?? undefined);
    const nextEntries = [
      entryWithThumb ? { ...nextEntry, thumbnailSvg: entryWithThumb } : nextEntry,
      ...indexResult.value.filter((entry) => entry.id !== nextDocument.id),
    ];
    await writeIndex(root, nextEntries);
    indexEntries = nextEntries;
  });
  return { document: nextDocument, indexEntries };
}


export async function deleteIntentCanvasDocuments(
  root: string,
  canvasIds: string[],
): Promise<void> {
  const uniqueCanvasIds = Array.from(
    new Set(
      canvasIds.flatMap((canvasId) => {
        const normalizedCanvasId = normalizeCanvasId(canvasId);
        return normalizedCanvasId ? [normalizedCanvasId] : [];
      }),
    ),
  );
  if (uniqueCanvasIds.length === 0) {
    return;
  }
  /* 各画布文件相互独立,并行 trash(评审:串行 await 逐个排队)。 */
  await Promise.all(uniqueCanvasIds.map(async (canvasId) => {
    try {
      await ipc.fsTrashEntry(`${await canvasDir(root)}/${resolveDocumentPath(canvasId)}`);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }));
  const deletedCanvasIds = new Set(uniqueCanvasIds);
  await withIndexTx(async () => {
    const fresh = await loadIntentCanvasIndex(root);
    if (fresh.warnings.length > 0) {
      throw new Error(t("画布索引读取失败,已中止删除索引更新:{warning}", { warning: fresh.warnings[0] ?? "" }));
    }
    await writeIndex(root, fresh.value.filter((entry) => !deletedCanvasIds.has(entry.id)));
  });
}

export async function deleteIntentCanvasDocument(
  root: string,
  canvasId: string,
): Promise<void> {
  await deleteIntentCanvasDocuments(root, [canvasId]);
}





