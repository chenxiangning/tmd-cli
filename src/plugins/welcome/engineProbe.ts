/**
 * 单引擎探针动作 —— ipc.cliProbe 薄壳(自 EngineCard.tsx 拆出,
 * only-export-components):供 WelcomePage 集中探针管理调用。
 */

import { ipc } from "@kernel/ipc";
import type { EngineProbeState } from "./EngineCard";

export async function probeEngine(binary: string): Promise<EngineProbeState> {
  try {
    const result = await ipc.cliProbe(binary);
    return { status: result.found ? "ok" : "notFound", result };
  } catch {
    return { status: "error", result: null };
  }
}
