/**
 * 转录导出 UI 面(0.4.0 候选14)—— SessionManage 批量条「导出」钮 + 活会话
 * 右键「导出转录快照」hook。选目录/选路径、进度与汇总 toast 在本件;
 * 帽 50 拒开跑、串行落盘循环与菜单装配在 transcriptExportRun.ts,落盘内核在
 * @plugins/session-viewer/exportMd。
 * toast 沿仓内局部 toast 惯例(viewerTab/PluginMarketPage 同款,无全局体系)。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { pickDirectory, pickSavePath } from "@kernel/ipc";
import { formatAbsolute } from "@kernel/relativeTime";
import { sessionExportFileName } from "@plugins/session-viewer/blocksToMarkdown";
import {
  exportReasonLabel,
  snapshotMdTo,
  type ExportSessionTarget,
} from "@plugins/session-viewer/exportMd";
import {
  exportSessionsBatch,
  planBatchExport,
  type BatchExportItem,
} from "./transcriptExportRun";

/** 自动消隐局部 toast;进度态 ttl=0 常驻 + cancellable,完成态默认消隐。 */
function useExportToast(ttlMs: number): {
  toast: { text: string; cancellable: boolean } | null;
  show: (text: string, opts?: { cancellable?: boolean; ttl?: number }) => void;
} {
  const [toast, setToast] = useState<{ text: string; cancellable: boolean } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const show = (text: string, opts?: { cancellable?: boolean; ttl?: number }) => {
    const ttl = opts?.ttl ?? ttlMs;
    setToast({ text, cancellable: opts?.cancellable ?? false });
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (ttl > 0) timer.current = window.setTimeout(() => setToast(null), ttl);
  };
  return { toast, show };
}

/** 局部 toast 挂点(进度态 cancellable 常驻,完成态自动消隐)。 */
function ExportToast(props: { toast: { text: string; cancellable: boolean } | null; onCancel?: () => void }) {
  if (!props.toast) return null;
  return (
    <div className="wm-toast" role="status">
      <span className="wm-toast-text">{props.toast.text}</span>
      {props.toast.cancellable && props.onCancel ? (
        <button type="button" className="wm-toast-cancel" onClick={props.onCancel}>
          {t("取消")}
        </button>
      ) : null}
    </div>
  );
}

/** 批量条「导出」钮:pickDirectory(取消静默)→ 串行导出 → 进度/汇总 toast。 */
export function BatchExportAction({ buildItems }: { buildItems: () => BatchExportItem[] }) {
  const { toast, show } = useExportToast(6000);
  const cancelRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = () => {
    if (busy) return;
    const plan = planBatchExport(buildItems());
    if ("blocked" in plan) {
      /* 帽 50:拒开跑,提示分批(不开目录对话框)。 */
      show(t("已选 {n},单批上限 50,请分批导出", { n: plan.count }));
      return;
    }
    const items = plan.items;
    if (items.length === 0) return;
    cancelRef.current = false;
    setBusy(true);
    void pickDirectory(t("导出会话转录"))
      .then((dir) => {
        /* 取消/web 桩态:静默不开跑(四消费先例同语义)。 */
        if (!dir) return undefined;
        return exportSessionsBatch(items, dir, {
          isCancelled: () => cancelRef.current,
          onProgress: (done, total) => {
            show(t("正在导出 {done}/{total}", { done, total }), { cancellable: true, ttl: 0 });
          },
        }).then((out) => {
          const head = out.aborted
            ? t("已写 {n} 个 · 中止于 {label}", { n: out.written, label: out.aborted })
            : out.cancelled
              ? t("已取消 · {n} 个已写入 {dir}", { n: out.written, dir })
              : t("{n} 个已写入 {dir}", { n: out.written, dir });
          const lines = [
            head,
            ...out.failures.map((f) => `${f.label} — ${exportReasonLabel(f.reason)}`),
          ];
          show(lines.join("\n"));
        });
      })
      .catch((e: unknown) => show(errTextDisplay(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button
        type="button"
        className="wm-bar-btn"
        disabled={busy}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={run}
      >
        {t("导出")}
      </button>
      <ExportToast toast={toast} onCancel={() => (cancelRef.current = true)} />
    </>
  );
}

/** 右键「导出转录快照」:pickSavePath 单文件(同 viewerTab 交互),toast 注明快照时点。 */
export function useSnapshotExport(): { run: (target: ExportSessionTarget) => void; toast: ReactNode } {
  const { toast, show } = useExportToast(3200);
  const run = (target: ExportSessionTarget) => {
    void pickSavePath(t("导出会话转录"), sessionExportFileName(target.title, target.cliSessionId))
      .then((path) => {
        if (!path) return; /* 取消/web 桩态:静默 */
        return snapshotMdTo(path, target).then((r) => {
          show(
            r.ok
              ? t("已导出转录快照 · 时点 {time}", { time: formatAbsolute(r.exportedAt) })
              : t("导出转录快照失败:{reason}", { reason: exportReasonLabel(r.reason) }),
          );
        });
      })
      .catch((e: unknown) => show(errTextDisplay(e)));
  };
  return {
    run,
    toast: toast === null ? null : (
      <div className="wm-toast" role="status">
        <span className="wm-toast-text">{toast.text}</span>
      </div>
    ),
  };
}
