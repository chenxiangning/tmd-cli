/**
 * DshHostPanel 的状态行渲染件 —— 标题/说明文案、已连接事实行、右侧动作簇。
 * 从 hostPanel.tsx 拆出(文件规模铁则);文案与纯函数拆至 hostPanelStatusModel.ts。
 */

import {
  ArrowClockwise,
  ArrowSquareOut,
  Play,
  Stop,
  X,
} from "@phosphor-icons/react";
import { openExternalUrl } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { webUiUrl, type DshConnection } from "./dshConnection";

/* 精致小按钮:细边、紧凑内距、小字号(与引擎行的 welcome-ab 视觉对齐)。 */
const BTN =
  "inline-flex items-center gap-1 rounded border border-(--tmd-border) px-1.5 py-0.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg) disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center gap-1 rounded border border-(--tmd-accent) bg-(--tmd-accent) px-1.5 py-0.5 text-xs text-(--tmd-accent-fg) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

/** 已连接事实行;空数组不渲染(与拆分前 connected && length>0 同效)。 */
export function HostFactsRow({ facts }: { facts: Array<[string, string]> }) {
  if (facts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3.5 text-sm">
      {facts.map(([label, value], i) => (
        <span key={label} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden className="h-3.5 w-px bg-(--tmd-border)" />}
          <span className="text-(--tmd-fg-muted)">
            {label} <span className="font-semibold text-(--tmd-fg)">{value}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** 状态行右侧动作簇:按 pending/connected/binFound/down 分支渲染按钮组。 */
export function HostActions({
  pending,
  connected,
  binFound,
  down,
  conn,
  onStart,
  onStop,
  onCancelStart,
  onRefresh,
}: {
  pending: "start" | "stop" | "check" | null;
  connected: boolean;
  binFound: boolean;
  down: boolean;
  conn: DshConnection;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onCancelStart: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  if (pending === "start") {
    return (
      <button type="button" className={BTN} onClick={() => void onCancelStart()}>
        <X size="0.6875rem" /> {t("取消启动")}
      </button>
    );
  }
  return (
    <>
      {connected && (
        <button
          type="button"
          className={BTN_PRIMARY}
          onClick={() => void openExternalUrl(webUiUrl(conn))}
        >
          <ArrowSquareOut size="0.6875rem" /> {t("打开 DSH Web UI")}
        </button>
      )}
      {connected && (
        <button
          type="button"
          className={BTN}
          disabled={pending !== null}
          onClick={() => void onStop()}
        >
          <Stop size="0.6875rem" /> {t("停止服务")}
        </button>
      )}
      {down && binFound && (
        <>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={pending !== null}
            onClick={() => void onStart()}
          >
            <Play size="0.6875rem" /> {t("立即启动")}
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => void openExternalUrl(webUiUrl(conn))}
          >
            <ArrowSquareOut size="0.6875rem" /> {t("仍尝试打开")}
          </button>
        </>
      )}
      {binFound && (
        <button
          type="button"
          className={BTN}
          disabled={pending !== null}
          onClick={() => void onRefresh()}
        >
          <ArrowClockwise size="0.6875rem" /> {t("重新检测")}
        </button>
      )}
    </>
  );
}
