/**
 * 审批线动作钩子 —— 通过/回退/应用/反悔四动作 + busy/notice 状态
 * (no-high-complexity 降分支):共用骨架(守卫 → busy → try/catch/notice →
 * finally 复位并刷新清单)收敛进 run,面板组件只留渲染分支。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { applyBatch, approveBatch, refreshBatches, revertBatch, undoRevertBatch } from "./store";

/** 错误短句:E_XXX 前缀剥掉,横幅直接可读。 */
function errMsg(e: unknown): string {
  return String(e).replace(/^E_\w+:\s*/, "");
}

/** 回退/应用结果 → 通知文案(跳过清单拼进句尾)。 */
function skippedNote(skipped: Array<{ path: string; reason: string }>): string {
  return skipped.map((s) => `${s.path}(${s.reason})`).join("、");
}

export function useCheckpointActions(
  cwd: string | null,
  sessionId: string | null,
  tmdSessionId: string | undefined,
) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** 四动作共用骨架:守卫 → busy → 动作落通知 → 复位并刷新。 */
  async function run(op: (cwd: string, sessionId: string) => Promise<string | null>) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    try {
      const message = await op(cwd, sessionId);
      if (message !== null) setNotice(message);
    } catch (e) {
      setNotice(errMsg(e));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }
  function doApprove(batchId: string) {
    return run(async (c) => {
      await approveBatch(c, batchId);
      return t("批次已标记通过 —— 仅记录状态,不影响任何文件");
    });
  }

  function doRevert(batchId: string, paths?: string[]) {
    return run(async (c) => {
      const out = await revertBatch(c, batchId, paths);
      const n = out.restored.length + out.deleted.length;
      const skipped = skippedNote(out.skipped);
      return skipped
        ? t("已回退 {n} 个文件;跳过:{skipped}", { n, skipped })
        : t("已回退 {n} 个路径 · 恢复点已留存,可反悔", { n });
    });
  }

  function doApply(batchId: string) {
    return run(async (c) => {
      const out = await applyBatch(c, batchId);
      const n = out.restored.length;
      const skipped = skippedNote(out.skipped);
      return n > 0
        ? skipped
          ? t("已应用 {n} 个文件;跳过:{skipped}", { n, skipped })
          : t("已应用 {n} 个文件 · 恢复点已留存,可反悔", { n })
        : skipped
          ? t("没有可应用的文件;跳过:{skipped}", { skipped })
          : t("没有可应用的文件");
    });
  }

  function doUndo(batchId: string) {
    return run(async (c) => {
      const out = await undoRevertBatch(c, batchId);
      return t("已从恢复点恢复 {n} 个文件,批次回到待审", { n: out.restored.length });
    });
  }

  return { busy, notice, setNotice, doApprove, doRevert, doApply, doUndo };
}
