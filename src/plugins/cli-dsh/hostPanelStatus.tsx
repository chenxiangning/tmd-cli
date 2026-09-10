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

export const BTN =
  "flex items-center gap-1 rounded-md border border-(--tmd-border) px-2.5 py-1 text-sm text-(--tmd-fg) hover:bg-(--tmd-bg-hover) disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_PRIMARY =
  "flex items-center gap-1 rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2.5 py-1 text-sm text-(--tmd-accent-fg) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

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
        <X size="0.8125rem" /> {t("取消启动")}
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
          <ArrowSquareOut size="0.8125rem" /> {t("打开 DSH Web UI")}
        </button>
      )}
      {connected && (
        <button
          type="button"
          className={BTN}
          disabled={pending !== null}
          onClick={() => void onStop()}
        >
          <Stop size="0.8125rem" /> {t("停止服务")}
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
            <Play size="0.8125rem" /> {t("立即启动")}
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => void openExternalUrl(webUiUrl(conn))}
          >
            <ArrowSquareOut size="0.8125rem" /> {t("仍尝试打开")}
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
          <ArrowClockwise size="0.8125rem" /> {t("重新检测")}
        </button>
      )}
    </>
  );
}
