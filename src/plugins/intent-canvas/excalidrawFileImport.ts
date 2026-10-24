/**
 * 意图画布 · .excalidraw 文件导入(文件树右键深链消费)。
 * 读文件(fs_read_file 512KB 读闸自然封顶)→ JSON 解析 → sanitizeIntentCanvasScene
 * (与画布加载同一不信任数据闸)→ 种子场景。错误文案已本地化,调用方直接展示。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { sanitizeIntentCanvasScene } from "./scene/sceneState";
import { isRecord } from "./utils/json";
import type { IntentCanvasScene } from "./types";

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

/** 读取 + 解析一步到位;读取失败(超 512KB 读闸/文件消失)文案随错误透传。 */
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
  return parseExcalidrawFile(raw, name);
}
