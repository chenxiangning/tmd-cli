/**
 * 引擎配置模型 —— 上游 magic-context.jsonc 实证项的读/序列化/文件读写。
 * 自 EngineConfigCard.tsx 拆出(only-export-components 铁则),卡片只留组件。
 */

import { ipc } from "@kernel/ipc";
import { engineConfigPath } from "../paths";
// cli-shared 消费声明:本 feature 插件经共享层消费 CLI 配置 JSONC 格式知识(见 jsonc.ts 头注)。
import { parseJsoncOrNull } from "../../cli-shared/jsonc";

export interface EngineConfig {
  historianModel: string;
  dreamerModel: string;
  sidekickModel: string;
  sidekickEnabled: boolean;
  embeddingEnabled: boolean;
}

function pickModel(block: unknown): string {
  if (block && typeof block === "object") {
    const omp = (block as Record<string, unknown>).omp as Record<string, unknown> | undefined;
    const pi = (block as Record<string, unknown>).pi as Record<string, unknown> | undefined;
    const any = (omp ?? pi) as Record<string, unknown> | undefined;
    return typeof any?.model === "string" ? any.model : "";
  }
  return "";
}

export function readEngineConfig(raw: Record<string, unknown> | null): EngineConfig {
  return {
    historianModel: pickModel(raw?.historian),
    dreamerModel: pickModel(raw?.dreamer),
    sidekickModel: pickModel(raw?.sidekick),
    sidekickEnabled: raw?.sidekick !== undefined,
    embeddingEnabled: true,
  };
}

/** 引擎配置 → 可写回的 jsonc 文本(per-harness:pi 为基座,omp 回退 pi,opencode 独立)。 */
export function serializeEngineConfig(config: EngineConfig, original: string | null): string {
  const base = parseJsoncOrNull(original ?? "") ?? {};
  const withModel = (block: unknown, model: string): unknown => ({
    ...(typeof block === "object" && block ? (block as Record<string, unknown>) : {}),
    pi: { ...(((block as Record<string, unknown>)?.pi as object) ?? {}), model },
    omp: { ...(((block as Record<string, unknown>)?.omp as object) ?? {}), model },
    opencode: { model },
  });
  base.historian = withModel(base.historian, config.historianModel);
  base.dreamer = withModel(base.dreamer, config.dreamerModel);
  if (config.sidekickEnabled) base.sidekick = withModel(base.sidekick, config.sidekickModel);
  return JSON.stringify(base, null, 2) + "\n";
}

export async function readEngineConfigFile(): Promise<{ config: EngineConfig; original: string }> {
  const p = await engineConfigPath();
  const original = await ipc.fsReadFile(p).catch(() => "");
  return { config: readEngineConfig(parseJsoncOrNull(original)), original };
}

export async function writeEngineConfigFile(
  config: EngineConfig,
  original: string | null,
): Promise<void> {
  const p = await engineConfigPath();
  await ipc.fsWriteFile(p, serializeEngineConfig(config, original));
}
