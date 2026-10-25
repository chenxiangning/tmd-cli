/**
 * 意图画布 · .excalidraw 文件导入(文件树右键深链消费)。
 * 读文件 → JSON 解析 → sanitizeIntentCanvasScene(与画布加载同一不信任数据闸)
 * → 种子场景。错误文案已本地化,调用方直接展示。
 *
 * 大小闸:fs_read_file 预览闸实为 100MB(Rust MAX_PREVIEW_BYTES),而画布文档
 * 写闸 496KB——前端按存储能力 512KB 早拒(aiDraw.ts 同款),不做读入后才失败的
 * 无效功。非保活 tab 切走重挂会重放 payload,导入消费走 claimImportRequestId
 * 跨重挂去重(canvasId 打开路径的重放是良性重开,不走此闸)。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { sanitizeIntentCanvasScene } from "./scene/sceneState";
import { isRecord } from "./utils/json";
import type { IntentCanvasScene } from "./types";

/* 导入画布文档上限(storage/documents MAX_DOCUMENT_JSON_BYTES 496KB 的对齐值)。 */
const MAX_IMPORT_BYTES = 512 * 1024;

const consumedImportRequestIds = new Set<number>();

/** 跨重挂消费去重:tab 切走重挂后同一深链 payload 不得二次导入(数据增殖)。
 *  true = 首次消费放行。集合超容量整体清空(重导同一文件的代价只是一次右键)。 */
export function claimImportRequestId(requestId: number): boolean {
  if (consumedImportRequestIds.size > 500) consumedImportRequestIds.clear();
  if (consumedImportRequestIds.has(requestId)) return false;
  consumedImportRequestIds.add(requestId);
  return true;
}

/** 文件名去 .excalidraw 后缀作画布标题;空名回落「导入的画布」。 */
export function titleFromExcalidrawName(name: string): string {
  const base = name.replace(/\.excalidraw$/i, "").trim();
  return base || t("导入的画布");
}

/** 解析并消毒 .excalidraw 文件字节;抛错文案已本地化(onFatalError 直接展示)。 */
export function parseExcalidrawFile(raw: string, name: string): { scene: IntentCanvasScene; title: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(t("「{name}」不是有效的 Excalidraw 文件(JSON 解析失败)", { name }));
  }
  if (!isRecord(parsed)) {
    throw new Error(t("「{name}」不是有效的 Excalidraw 文件", { name }));
  }
  const scene = sanitizeIntentCanvasScene(
    Array.isArray(parsed.elements) ? parsed.elements : [],
    parsed.appState ?? {},
    parsed.files ?? {},
  );
  if (scene.elements.length === 0) {
    throw new Error(t("「{name}」里没有可导入的画布元素", { name }));
  }
  return { scene, title: titleFromExcalidrawName(name) };
}

/** 读取 + 解析一步到位;超 512KB 前端闸早拒(存储写不进,不读入后才失败),
 *  读取失败文案随错误透传。 */
export async function importExcalidrawFile(
  path: string,
  name: string,
): Promise<{ scene: IntentCanvasScene; title: string }> {
  let raw: string;
  try {
    raw = await ipc.fsReadFile(path);
  } catch (error) {
    throw new Error(
      t("无法读取「{name}」:{message}", { name, message: error instanceof Error ? error.message : String(error) }),
    );
  }
  if (raw.length > MAX_IMPORT_BYTES) {
    throw new Error(t("「{name}」超过 512KB,超出画布存储上限", { name }));
  }
  return parseExcalidrawFile(raw, name);
}
