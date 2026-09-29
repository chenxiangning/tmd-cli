/**
 * AI 作画导入器(自 aiDraw.ts 拆出,守行数铁则)。
 * inbox 轮询/单文件导入:投影复用 sceneElements 种子管线,append 进目标画布或
 * 新建;失败移 inbox/failed/ 留证。协议解析在 aiDraw.ts。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { IntentCanvasDocument } from "./types";
import { createSeedElement } from "./scene/sceneElements";
import { buildIntentCanvasAiContext, sanitizeIntentCanvasScene } from "./scene/sceneState";
import {
  appendIntentCanvasScene,
  appendIntentCanvasSummary,
} from "./storage/documentOps";
import {
  loadIntentCanvasIndex,
  loadIntentCanvasDocument,
  saveIntentCanvasDocument,
} from "./storage/documents";
import { aiInboxDir, isMissingFileError } from "./storage/paths";

/* 留证后 trash 仍失败的文件(杀软/同步盘锁):跳过集合防 2s 轮询无限重复导入
   同一文件(评审 P2)。webview 生命周期内有效,重开 tab 自然重试一次。 */
const untrashableFiles = new Set<string>();
import { AI_DRAW_FILE_RE, parseAiDrawFile, projectAiDrawShapes, type AiDrawFile, type AiDrawImportResult } from "./aiDraw";

async function resolveTargetDocument(
  root: string,
  file: AiDrawFile,
): Promise<IntentCanvasDocument | null> {
  if (file.canvasId) {
    try {
      return await loadIntentCanvasDocument(root, file.canvasId);
    } catch (error) {
      /* 指定 id 不存在才按 title/new 兜底;超限/损坏等错误上抛,
         防止在真实存在但读不出的画布上静默新建重名画布(内容分裂)。 */
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
  if (file.title) {
    const index = await loadIntentCanvasIndex(root);
    if (index.warnings.length > 0) {
      /* 索引读失败时空快照不可当「无同名画布」:静默新建会与盘上现存画布重名
         分裂。抛错进 failed/ 留证,索引修好后自动可重导(评审 P2)。 */
      throw new Error(`index unreadable: ${index.warnings[0] ?? ""}`);
    }
    const hit = index.value.find(
      (entry) => entry.title.trim() === file.title!.trim(),
    );
    if (hit) {
      return loadIntentCanvasDocument(root, hit.id);
    }
  }
  return null;
}

/** 导入单条指令:append 进目标画布 / new 新建,返回画布标题供提示。 */
export async function importAiDrawFile(
  root: string,
  file: AiDrawFile,
  workspace: { id: string; name: string | null } = { id: root, name: null },
): Promise<AiDrawImportResult> {
  const seedShapes = projectAiDrawShapes(file.shapes);
  const appendedScene = sanitizeIntentCanvasScene(
    seedShapes.map((shape, index) => createSeedElement(shape, index)),
    {},
    {},
  );
  const target = file.mode === "new" ? null : await resolveTargetDocument(root, file);
  if (!target) {
    const document = createIntentCanvasDocumentForAiDraw(file, appendedScene, workspace);
    const saved = await saveIntentCanvasDocument(root, document);
    return { ok: true, canvasId: saved.id, canvasTitle: saved.title };
  }
  const nextScene = appendIntentCanvasScene(target.scene, appendedScene);
  const nextSummary = appendIntentCanvasSummary(target.summary, file.summary ?? "");
  const nextDocument: IntentCanvasDocument = {
    ...target,
    summary: nextSummary,
    scene: nextScene,
    aiContext: buildIntentCanvasAiContext(nextScene, nextSummary),
  };
  const saved = await saveIntentCanvasDocument(root, nextDocument);
  return { ok: true, canvasId: saved.id, canvasTitle: saved.title };
}

function createIntentCanvasDocumentForAiDraw(
  file: AiDrawFile,
  appendedScene: IntentCanvasDocument["scene"],
  workspace: { id: string; name: string | null },
): IntentCanvasDocument {
  const now = new Date().toISOString();
  const id = `canvas-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const scene = appendedScene;
  return {
    version: 1,
    kind: "intent-canvas",
    id,
    title: file.title?.trim() || t("AI 画布"),
    createdAt: now,
    updatedAt: now,
    workspace,
    mode: "architect",
    summary: file.summary ?? "",
    links: { projectMapNodeIds: [], filePaths: [], threadIds: [] },
    scene,
    aiContext: buildIntentCanvasAiContext(scene, file.summary ?? ""),
    semanticGraphs: [],
    aiAnnotations: [],
  };
}

/**
 * 扫 inbox 并导入全部待处理文件。返回本次成功导入的画布标题列表;
 * 单文件失败不阻断其余,失败文件移 inbox/failed/ 留证。
 */
let pollInFlight = false;

export async function pollAiDrawInbox(
  root: string,
  workspace: { id: string; name: string | null } = { id: root, name: null },
): Promise<{ id: string; title: string }[]> {
  /* 模块级重入闸(双保险;hook 侧亦有 running 旗标)。 */
  if (pollInFlight) {
    return [];
  }
  pollInFlight = true;
  try {
    return await pollAiDrawInboxInner(root, workspace);
  } finally {
    pollInFlight = false;
  }
}

async function pollAiDrawInboxInner(
  root: string,
  workspace: { id: string; name: string | null },
): Promise<{ id: string; title: string }[]> {
  const inbox = await aiInboxDir(root);
  /* 幂等建目录:prompt 让 AI 往 inbox 写文件,目录必须由客户端兜底创建,
     否则依赖各 CLI 写文件工具的父目录行为,首次作画可能 ENOENT。 */
  await ipc.fsCreateDir(inbox).catch(() => undefined);
  const entries = await ipc.fsListDir(inbox).catch(() => []);
  const importedCanvases: { id: string; title: string }[] = [];
  for (const entry of entries) {
    if (entry.isDir || !AI_DRAW_FILE_RE.test(entry.name) || untrashableFiles.has(entry.path)) {
      continue;
    }
    try {
      const raw = await ipc.fsReadFile(entry.path);
      const file = parseAiDrawFile(raw);
      const result = await importAiDrawFile(root, file, workspace);
      /* importAiDrawFile 失败路径一律抛错走 catch;ok 结果直接入账。 */
      importedCanvases.push({ id: result.canvasId, title: result.canvasTitle });
      await ipc.fsTrashEntry(entry.path).catch(async () => {
        /* 源文件消费失败会导致下轮重复导入:降级移 failed 止损。 */
        await moveToFailed(inbox, entry.path, entry.name, "trash failed after import");
      });
    } catch (error) {
      await moveToFailed(inbox, entry.path, entry.name, error instanceof Error ? error.message : String(error));
    }
  }
  return importedCanvases;
}

async function moveToFailed(inbox: string, filePath: string, fileName: string, error: string): Promise<void> {
  try {
    const failedDir = `${inbox}/failed`;
    await ipc.fsCreateDir(failedDir).catch(() => undefined);
    const raw = await ipc.fsReadFile(filePath).catch(() => "");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await ipc.fsWriteFile(
      `${failedDir}/${stamp}-${fileName}.err`,
      `${raw}\n\n/* 导入失败:${error} */\n`,
    );
    await ipc.fsTrashEntry(filePath).catch(() => {
      untrashableFiles.add(filePath);
    });
  } catch {
    /* 留证失败静默:主流程已把该文件跳过。 */
  }
}

/** inbox 绝对路径(供设置页/提示词展示)。 */
export async function aiDrawInboxPath(root: string): Promise<string> {
  return aiInboxDir(root);
}


