/**
 * 意图画布 · 文档 CRUD(sidecar ipc.fs* 通道,移植自 mossx intentCanvasStorage)。
 * mossx 的 Rust 原子写/锁在单用户桌面 + 按钮驱动写入下不做;保存对索引事务化:
 * 文档先写、索引失稳即回滚本次文档写(全有或全无),回滚自身失败才退回
 * 半写态由下次保存自愈。索引侧并发由 withIndexTx 内存锁串行化。
 */
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { cacheAiDrawLatestCanvas } from "../aiDrawPrompt";
import type {
  IntentCanvasDocument,
  IntentCanvasIndexEntry,
  IntentCanvasLoadResult,
} from "../types";
import { buildIntentCanvasAiContext } from "../scene/sceneState";
import { buildIntentCanvasThumbnailSvg } from "../utils/thumbnail";
import { compareIndexEntries, writeIndex } from "./indexWrite";
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
    const canvases = indexFile.canvases.slice().sort((left, right) => compareIndexEntries(left, right));
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


/* 索引同受 fs_read_file 512KB 读闸(预算与剥缩略图见 ./indexWrite)。 */

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
   抹掉导入的图形。AI 导入自身 load-then-save 时间戳相等,不受此闸影响。
   返回盘上旧字节(null = 新建),供索引失稳时回滚恢复。 */
class CanvasStaleOverwriteError extends Error {}

async function readPriorDocumentRaw(document: IntentCanvasDocument, path: string): Promise<string | null> {
  const raw = await ipc.fsReadFile(path).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }
  try {
    const existing = normalizeIntentCanvasDocument(JSON.parse(raw));
    /* 孤儿认领:盘上字节与上次回滚失败的本次写入全等 = 这是我们自己的孤儿文档,
       不是别人的新内容,放行覆写(否则新建象限恒拦死)。认领即清账。 */
    if (orphanClaims.get(path) === raw) {
      orphanClaims.delete(path);
      return raw;
    }
    if (existing && existing.updatedAt > document.updatedAt) {
      throw new CanvasStaleOverwriteError(
        t("画布已在其他入口更新(AI 作画导入),请返回列表重新打开后再保存,否则会覆盖新内容。"),
      );
    }
  } catch (error) {
    if (error instanceof CanvasStaleOverwriteError) {
      throw error;
    }
    /* 盘上文档损坏:不影响本次保存(保存即修复);旧字节仍可作回滚基线。 */
  }
  return raw;
}

/* 索引侧失稳时回滚本次文档写,保存对索引全有或全无:覆写恢复旧字节,新建删新文件。
   先核对盘上仍是本次写入的字节(锁内已无应用内并发,此核对兜外部写方);回滚自身
   失败不静默:console.warn + 把「路径 → 本次写入字节」记入 orphanClaims,下次保存
   的覆写闸凭全等字节认领自家孤儿放行(否则新建象限 stale 闸恒拦、画布无路可重开)。 */
const orphanClaims = new Map<string, string>();

async function rollbackDocumentWrite(documentPath: string, priorRaw: string | null, writtenJson: string): Promise<void> {
  try {
    const current = await ipc.fsReadFile(documentPath).catch(() => null);
    if (current !== writtenJson) {
      return;
    }
    if (priorRaw === null) {
      await ipc.fsRemovePath(documentPath);
    } else {
      await ipc.fsWriteFile(documentPath, priorRaw);
    }
    orphanClaims.delete(documentPath);
  } catch (error) {
    orphanClaims.set(documentPath, writtenJson);
    console.warn("[intent-canvas] 保存回滚失败(文档维持半写态,已记孤儿认领):", error);
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
  /* 整段保存(覆写闸 + 文档写 + 索引更新)都在索引事务锁内:保存与 AI 导入两个
     写方全串行,「gate 过后、写入前盘上换人」与「回滚 check-then-act 窗口被插入」
     两类交错从结构上不存在。缩略图构建在锁内,代价是另一写方多等一次导出,可接受。 */
  let indexEntries: IntentCanvasIndexEntry[] = [];
  await withIndexTx(async () => {
    /* 比较基线必须是调用方内存里的 document(加载/上次保存时刻),不能用
       已盖 now 的 nextDocument —— 否则只有「保存瞬间并发写盘」才触发,真实的
       「AI 导入发生在 load 与 save 之间」永不命中(评审 P1 残余缺口)。 */
    const priorRaw = await readPriorDocumentRaw(document, documentPath);
    await ipc.fsWriteFile(documentPath, json);
    try {
      const thumbnailSvg = await buildIntentCanvasThumbnailSvg(nextDocument.scene);
      const nextEntry: IntentCanvasIndexEntry = {
        ...buildIndexEntry(nextDocument),
        ...(thumbnailSvg ? { thumbnailSvg } : {}),
      };
      /* 写后索引条目随返回值带出(2026-10-06):调用方直接落列表态,免保存后
       * 再全量读一次索引(每次保存省 ~0.5MB 读 + parse)。 */
      const indexResult = await loadIntentCanvasIndex(root);
      if (indexResult.warnings.length > 0) {
        /* 读失败时的空快照不可作覆写基线:整表覆写会把其余画布从列表抹掉且无重建
           路径。抛错交外层回滚本次文档写,索引原样保留。 */
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
    } catch (error) {
      await rollbackDocumentWrite(documentPath, priorRaw, json);
      throw error;
    }
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





